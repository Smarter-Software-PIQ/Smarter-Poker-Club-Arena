# The tight-read worker test pins its decision time (2026-11-15)

`anOrdinaryTightRegularThroughTheWorker.test.ts` (from #10927) built its request with the wall clock as the decision time. The decision key binds the decision hour and the worker seeds the decision's random stream from that key, so the hour chose the draw; in the 11Z hour on 2026-11-15 the deep look landed on the other side of it from the fast look and the test failed on unchanged main. Same cause #10955 fixed in the pre-repair worker test.

The test now uses a fixed decision time and adds a case that runs the decision with the clock faked at 11:30Z, 07:05Z, 14:30Z and 17:30Z and requires the same result. Test only; production decisions record their time once and both looks of one decision read the same hour.
