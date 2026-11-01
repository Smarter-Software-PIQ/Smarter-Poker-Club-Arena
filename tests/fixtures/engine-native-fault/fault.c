/* Isolated qualification only: no production loader or capture hook. */
#include <node_api.h>
#include <signal.h>
#include <setjmp.h>
#include <stdint.h>
static sigjmp_buf resume_fault;
__attribute__((noinline,visibility("default"))) void sp_fault_leaf(void) {
#if defined(__x86_64__)
  /* Noncanonical for both 48-bit and 57-bit userspace: synchronous #GP. */
  *(volatile uint64_t *)(uintptr_t)0x8000000000000000ULL = 1;
#else
#error "This fixture qualifies the observed x86_64 GPF only"
#endif
}
__attribute__((noinline,visibility("default"))) void sp_fault_caller(void) { sp_fault_leaf(); }
static void resume_handler(int signal) { (void)signal; siglongjmp(resume_fault, 1); }
static napi_value fault(napi_env env, napi_callback_info info) {
  (void)info; sp_fault_caller(); return NULL;
}
static napi_value storm(napi_env env, napi_callback_info info) {
  (void)info; struct sigaction action = {0}; action.sa_handler = resume_handler;
  sigemptyset(&action.sa_mask); sigaction(SIGSEGV, &action, NULL);
  for (int i=0;i<256;i++) if (!sigsetjmp(resume_fault,1)) sp_fault_caller();
  napi_value result; napi_get_undefined(env,&result); return result;
}
static napi_value init(napi_env env, napi_value exports) {
  napi_value a,b; napi_create_function(env,"fault",5,fault,NULL,&a);
  napi_create_function(env,"storm",5,storm,NULL,&b);
  napi_set_named_property(env,exports,"fault",a); napi_set_named_property(env,exports,"storm",b);
  return exports;
}
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
