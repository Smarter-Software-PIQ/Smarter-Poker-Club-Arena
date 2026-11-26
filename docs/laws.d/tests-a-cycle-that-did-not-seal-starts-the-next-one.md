# tests/a-cycle-that-did-not-seal-starts-the-next-one.law.test.ts

O27: when a three-hourly cycle keeps serving or does not seal, Stage's owner run waits once to the cycle start + 25 minutes and starts one "Backup after keep-serving <cycle>" certification of main, whose successful completion Stage admits as the next cycle's election trigger; the job can only dispatch that one workflow.
