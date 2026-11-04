# Tournament client creation fixtures own their clock

Three client suites were testing creation payloads, schedule replay and lost acknowledgements with the machine clock. At 00:57 Chicago their immediate starts correctly failed production admission hours, and the lost-acknowledgement test never reached its first request. The exact CI clock reproduced all 20 failures across these suites.

The payload suite and the two affected replay cases now use an explicit noon Chicago fixture clock. Date-only fake timers preserve real component scheduling; the existing transport test retains its fake timer controls. Clock state is restored after each test. The lost-acknowledgement case additionally proves the first RPC reached its mocked authority before advancing beyond the saved start time. Production policy, daylight-saving coverage and existing payload assertions are unchanged.
