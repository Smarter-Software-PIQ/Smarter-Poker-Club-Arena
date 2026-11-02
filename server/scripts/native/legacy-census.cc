// Public V8 API only. This module is deliberately ABI-specific.
#include <node.h>
#include <node_version.h>
#include <v8-profiler.h>
#include <v8-microtask-queue.h>
#include <chrono>
#include <cmath>
#include <cstring>
#include <limits>
#include <vector>
#include <array>
#ifndef LEGACY_CENSUS_SOURCE_SHA256
#error "Maintained source hash must be supplied by the pinned build"
#endif

namespace legacy_census {
constexpr size_t kMatches = 4000 + 4000 + 2000 + 4000 + 4000 + 4096;
constexpr size_t kCleanup = 32 * 1024 * 1024;
constexpr size_t kPrototypeEntries = 4096;
constexpr size_t kPrototypeSlots = 8192;
constexpr size_t kPrototypeProbes = 8;
// Fixed cache and at most 4096 escaped local handles plus handle-block slack.
constexpr size_t kPrototypeReserve = 1024 * 1024;
// Array::New(values,n) allocates one fixed backing store and one JSArray.
// Four full-width pointers per element + 64 KiB for headers/alignment/result
// metadata conservatively exceed the pinned V8 allocation (see contract).
constexpr size_t kManagedOutput = kMatches * sizeof(void*) * 4 + 65536;
static_assert(sizeof(void*) == 8, "Only pinned 64-bit runtimes supported");
constexpr const char* kV8 = "12.4.254.21-node.56";
static_assert(NODE_MAJOR_VERSION == 22 && NODE_MINOR_VERSION == 23 &&
              NODE_PATCH_VERSION == 2 && NODE_MODULE_VERSION == 127,
              "Exact Node 22.23.2 headers required");
int64_t Now() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
      std::chrono::system_clock::now().time_since_epoch()).count();
}
void Refuse(v8::Isolate* isolate, const char* message) {
  isolate->ThrowException(v8::Exception::Error(
      v8::String::NewFromUtf8(isolate, message).ToLocalChecked()));
}
struct Attempt {
  uint64_t predicateVisits = 0, validPredicateVisits = 0, matched = 0;
  int64_t queryStartedAtMs = 0, firstValidAtMs = 0, lastValidAtMs = 0, queryEndedAtMs = 0;
  bool overflow = false, deadlineRefused = false, arrayAllocated = false;
};
thread_local Attempt lastAttempt;
// Local pins escape only on insertion. The pinned QueryObjects second pass
// uses the explicit Collect scope with no per-iteration scope; entries are never
// read after that call returns. No Global handles or young-global list growth.
class PrototypeCache final {
 public:
  struct Entry { v8::Local<v8::Object> prototype; bool matches = false; };
  bool Lookup(v8::Local<v8::Object> prototype, int hash,
              bool* matches, size_t* vacant) const {
    *vacant = kPrototypeSlots;
    const size_t start = static_cast<unsigned>(hash) & (kPrototypeSlots - 1);
    for (size_t probe = 0; probe < kPrototypeProbes; ++probe) {
      const size_t slot = (start + probe) & (kPrototypeSlots - 1);
      const auto index = slots_[slot];
      if (index == 0) { *vacant = slot; return false; }
      const auto& entry = entries_[index - 1];
      if (entry.prototype->StrictEquals(prototype)) {
        *matches = entry.matches; return true;
      }
    }
    return false;
  }
  bool CanStore(size_t vacant) const {
    return vacant != kPrototypeSlots && size_ < kPrototypeEntries;
  }
  void Store(v8::Local<v8::Object> prototype, size_t vacant, bool matches) {
    entries_[size_] = {prototype, matches};
    slots_[vacant] = static_cast<uint16_t>(++size_);
  }
 private:
  std::array<Entry, kPrototypeEntries> entries_{};
  std::array<uint16_t, kPrototypeSlots> slots_{};
  size_t size_ = 0;
};
static_assert(sizeof(PrototypeCache) + kPrototypeEntries * 16 + 32768 < kPrototypeReserve,
              "Fixed cache, one pin per entry, plus handle-block slack");
class Predicate final : public v8::QueryObjectPredicate {
 public:
  Predicate(v8::Local<v8::Context> context, v8::Local<v8::Object> marker,
            int64_t deadline)
      : context_(context), marker_(marker), deadline_(deadline) {}
  bool Filter(v8::Local<v8::Object> object) override {
    bool store = false;
    size_t vacant = kPrototypeSlots;
    const bool matches = Classify(object, &store, &vacant);
    if (store && cache_.CanStore(vacant)) {
      // Classify's ordinary scope has CLOSED. Only a newly completed entry
      // allocates an escape slot in QueryObjects' enclosing scope. No user
      // callback or microtask can mutate this ordinary prototype between reads.
      v8::EscapableHandleScope pin(context_->GetIsolate());
      const auto prototype = object->GetPrototype().As<v8::Object>();
      cache_.Store(pin.Escape(prototype), vacant, matches);
    }
    if (!matches) return false;
    if (++lastAttempt.matched > kMatches) {
      lastAttempt.overflow = true;
      return false;
    }
    return true;
  }
  bool failed_ = false;
 private:
  bool Classify(v8::Local<v8::Object> object, bool* store, size_t* vacant) {
    // QueryObjects does not scope its second-pass predicate callbacks. Keep
    // context/prototype traversal handles local to this visit. Matches are
    // promoted by V8 after this boolean predicate returns.
    v8::HandleScope handles(context_->GetIsolate());
    ++lastAttempt.predicateVisits;
    const auto now = Now();
    if (now >= deadline_) {
      failed_ = true; lastAttempt.deadlineRefused = true; return false;
    }
    ++lastAttempt.validPredicateVisits;
    if (!lastAttempt.firstValidAtMs) lastAttempt.firstValidAtMs = now;
    lastAttempt.lastValidAtMs = now;
    if (lastAttempt.overflow) return false;
    if (object->IsProxy() || object->IsModuleNamespaceObject()) return false;
    v8::Local<v8::Context> creation;
    if (!object->GetCreationContext().ToLocal(&creation) || creation != context_)
      return false;
    v8::Local<v8::Value> cursor = object->GetPrototype();
    if (!cursor->IsObject()) return false;
    const auto prototype = cursor.As<v8::Object>();
    // Preserve the original common shallow path without hashing or pinning.
    // Only a chain deeper than these exact first two iterations uses the cache.
    for (size_t depth = 0; depth < 2; ++depth) {
      if (!cursor->IsObject()) return false;
      if (cursor->IsProxy()) return false;
      if (cursor == marker_) return true;
      cursor = cursor.As<v8::Object>()->GetPrototype();
    }
    if (!cursor->IsObject()) return false;
    // Pinned V8 implementation executes identity hashing without GC or script.
    const int hash = prototype->GetIdentityHash();
    bool cached;
    if (cache_.Lookup(prototype, hash, &cached, vacant)) return cached;
    for (size_t depth = 2; cursor->IsObject(); ++depth) {
      if (cursor->IsProxy()) return false;
      if (cursor == marker_) {
        *store = true;
        return true;
      }
      if (depth >= 256) { failed_ = true; return false; }
      cursor = cursor.As<v8::Object>()->GetPrototype();
    }
    *store = true;
    return false;
  }
  PrototypeCache cache_;
  v8::Local<v8::Context> context_;
  v8::Local<v8::Object> marker_;
  int64_t deadline_;
};
void Collect(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  v8::HandleScope collect_handles(isolate);
  auto context = isolate->GetCurrentContext();
  lastAttempt = Attempt{};
  const bool eed_profile = args.Length() == 4 && args[3]->IsString() &&
      args[3].As<v8::String>()->StringEquals(
          v8::String::NewFromUtf8Literal(isolate, "eed-80s-v1"));
  if (std::strcmp(v8::V8::GetVersion(), kV8) != 0 ||
      (args.Length() != 3 && !eed_profile) ||
      !args[0]->IsObject() || args[0]->IsProxy() || !args[1]->IsNumber() ||
      !args[2]->IsNumber()) {
    Refuse(isolate, "native census ABI or arguments refused"); return;
  }
  const double deadline_value = args[1].As<v8::Number>()->Value();
  const double process_available = args[2].As<v8::Number>()->Value();
  const int64_t now = Now();
  if (!std::isfinite(deadline_value) || std::floor(deadline_value) != deadline_value ||
      deadline_value <= now || deadline_value > now + (eed_profile ? 59000 : 40000) ||
      !std::isfinite(process_available) || process_available <= 0 ||
      std::floor(process_available) != process_available ||
      process_available > 9007199254740991.0) {
    Refuse(isolate, "native census deadline or process admission refused"); return;
  }
  const auto deadline = static_cast<int64_t>(deadline_value);
  v8::HeapStatistics before;
  isolate->GetHeapStatistics(&before);
  const double process_required = before.used_heap_size() * 8.0 + kCleanup + kPrototypeReserve;
  if (process_available < process_required ||
      before.total_available_size() < kCleanup + kManagedOutput + kPrototypeReserve) {
    Refuse(isolate, "native census memory headroom refused"); return;
  }
  // The EED-only extended profile keeps the qualified 12ms/decimal-MB
  // estimator. Read it in this synchronous callback, immediately before the
  // same QueryObjects algorithm, so an earlier publisher read cannot admit a
  // heap that grew before native entry. One extra MB preserves ceil(MB)+1
  // conservatism without rounding a fractional MB down.
  if (eed_profile) {
    const double estimated_ms = std::ceil((before.used_heap_size() / 1000000.0 + 1) * 12);
    if (estimated_ms > deadline - Now()) {
      Refuse(isolate, "native census EED heap time admission refused"); return;
    }
  }
  // This is the SAME public QueryObjects entry as Inspector: V8 owns its
  // stack marker, typed-array normalization, full GC and exhaustive iteration.
  // Globals hold every match until success or destruction on every refusal.
  std::vector<v8::Global<v8::Object>> matches;
  Predicate predicate(context, args[0].As<v8::Object>(), deadline);
  lastAttempt.queryStartedAtMs = Now();
  isolate->GetHeapProfiler()->QueryObjects(context, &predicate, &matches);
  lastAttempt.queryEndedAtMs = Now();
  if (lastAttempt.overflow) {
    Refuse(isolate, "native census matched output overflow before array"); return;
  }
  if (predicate.failed_ || Now() >= deadline) {
    Refuse(isolate, "native census deadline or topology refused"); return;
  }
  if (matches.size() > kMatches) {
    Refuse(isolate, "native census matched output overflow before array"); return;
  }
  v8::HeapStatistics after;
  isolate->GetHeapStatistics(&after);
  if (after.total_available_size() < kCleanup + kManagedOutput + kPrototypeReserve) {
    Refuse(isolate, "native census post-query headroom refused"); return;
  }
  v8::MicrotasksScope microtasks(context, v8::MicrotasksScope::kDoNotRunMicrotasks);
  v8::LocalVector<v8::Value> values(isolate);
  values.reserve(matches.size());
  for (auto& value : matches) values.push_back(value.Get(isolate));
  auto result = v8::Array::New(isolate, values.data(), values.size());
  lastAttempt.arrayAllocated = true;
  if (Now() >= deadline) {
    Refuse(isolate, "native census output deadline refused"); return;
  }
  args.GetReturnValue().Set(result);
}
// Bounded phase diagnostics contain no object handles or application data.
// They distinguish real in-scan expiry from refusal before native work began.
void Diagnostics(const v8::FunctionCallbackInfo<v8::Value>& args) {
  auto* isolate = args.GetIsolate();
  auto context = isolate->GetCurrentContext();
  auto out = v8::Object::New(isolate);
#define NUMBER(name) out->CreateDataProperty(context, v8::String::NewFromUtf8Literal(isolate, #name), v8::Number::New(isolate, lastAttempt.name)).Check()
#define BOOLEAN(name) out->CreateDataProperty(context, v8::String::NewFromUtf8Literal(isolate, #name), v8::Boolean::New(isolate, lastAttempt.name)).Check()
  NUMBER(predicateVisits); NUMBER(validPredicateVisits); NUMBER(matched);
  NUMBER(queryStartedAtMs); NUMBER(firstValidAtMs); NUMBER(lastValidAtMs); NUMBER(queryEndedAtMs);
  BOOLEAN(overflow); BOOLEAN(deadlineRefused); BOOLEAN(arrayAllocated);
#undef NUMBER
#undef BOOLEAN
  args.GetReturnValue().Set(out);
}
void Initialize(v8::Local<v8::Object> exports) {
  NODE_SET_METHOD(exports, "collect", Collect);
  NODE_SET_METHOD(exports, "diagnostics", Diagnostics);
  auto* isolate = exports->GetIsolate();
  auto context = isolate->GetCurrentContext();
  exports->CreateDataProperty(context,
      v8::String::NewFromUtf8Literal(isolate, "sourceSHA256"),
      v8::String::NewFromUtf8Literal(isolate, LEGACY_CENSUS_SOURCE_SHA256)).Check();
  exports->CreateDataProperty(context,
      v8::String::NewFromUtf8Literal(isolate, "maxMatches"),
      v8::Integer::New(isolate, kMatches)).Check();
  exports->CreateDataProperty(context,
      v8::String::NewFromUtf8Literal(isolate, "prototypeCacheBytes"),
      v8::Integer::New(isolate, kPrototypeReserve)).Check();
  exports->CreateDataProperty(context,
      v8::String::NewFromUtf8Literal(isolate, "managedOutputBytes"),
      v8::Integer::New(isolate, kManagedOutput)).Check();
}
NODE_MODULE(NODE_GYP_MODULE_NAME, Initialize)
}  // namespace legacy_census
