// Qualification only. Never linked into or copied to the engine image.
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <dlfcn.h>

static std::chrono::system_clock::time_point controlled_clock(void* return_address) noexcept {
  using Clock = std::chrono::system_clock;
  using Original = Clock::time_point (*)() noexcept;
#ifdef __APPLE__
  constexpr const char* symbol = "_ZNSt3__16chrono12system_clock3nowEv";
#else
  constexpr const char* symbol = "_ZNSt6chrono3_V212system_clock3nowEv";
#endif
#ifdef __APPLE__
  // dyld interposition leaves references from the interposing image original.
  static Original original = &Clock::now;
#else
  static auto original = reinterpret_cast<Original>(dlsym(RTLD_NEXT, symbol));
#endif
  if (!original) std::abort(); // Unsupported symbol binding cannot qualify.
  Dl_info caller{};
  if (!dladdr(return_address, &caller) || !caller.dli_fname)
    return original();
  const char* expected = std::getenv("CENSUS_QUALIFICATION_CLOCK_IMAGE");
  if (!expected || std::strcmp(caller.dli_fname, expected) != 0) return original();
  // Optimized addon calls the external chrono clock even when Now is inlined.
  // Its two pre-traversal reads leave98 valid predicate visits before expiry.
  static unsigned int reads = 0;
  static Clock::time_point base = original();
  return base + (++reads > 100 ? std::chrono::seconds(60) : std::chrono::seconds(0));
}

#ifdef __APPLE__
static std::chrono::system_clock::time_point replacement_clock() noexcept {
  return controlled_clock(__builtin_return_address(0));
}
__attribute__((used)) static const struct {
  const void* replacement;
  const void* original;
} clock_interposition __attribute__((section("__DATA,__interpose"))) = {
  reinterpret_cast<const void*>(&replacement_clock),
  reinterpret_cast<const void*>(&std::chrono::system_clock::now)
};
#else
std::chrono::system_clock::time_point std::chrono::system_clock::now() noexcept {
  return controlled_clock(__builtin_return_address(0));
}
#endif
