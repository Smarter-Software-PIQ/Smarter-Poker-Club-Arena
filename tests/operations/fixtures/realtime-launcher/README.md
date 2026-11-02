These credential-free fixtures preserve the pinned launcher preimages used by
the Docker build. They are not service implementations or native proof.

- `realtime.sh`: Elixir v1.19.5 `Mix.Tasks.Release.Init.cli_text`, with its
  documented heredoc indentation removed and its two EEx expressions rendered
  for release name `realtime` and default `-mode $RELEASE_MODE`. Supabase
  Realtime v2.144.0 `mix.exs` has no reboot-system-after-config override.
  SHA256: `b35710db4fe3c141340dac83d02fbe9d3c8407ff600eb98915f54feb69e227a9`.
- `env.sh`: exact Supabase Realtime v2.144.0 `rel/env.sh.eex` bytes, containing
  no EEx expressions. SHA256:
  `3fbe75e1c0ea82357e01a38af7666f2f54fac8e389c303084a45a48aeb178121`.
- `runtime.exs`: exact Supabase Realtime v2.144.0 `config/runtime.exs` bytes.
  SHA256: `38b717da09ddb06a090075a27206fef346ef39c6f5928af6073df921f2c38567`.
  The fixture adds the loopback address to the HTTP listener's socket
  options and the fixed private discovery channel. The genuine service must prove the resulting Linux listener at run time.

Sources:
https://github.com/elixir-lang/elixir/blob/v1.19.5/lib/mix/lib/mix/tasks/release.init.ex
https://github.com/elixir-lang/elixir/blob/v1.19.5/lib/mix/lib/mix/tasks/release.ex
https://github.com/supabase/realtime/blob/v2.144.0/rel/env.sh.eex
https://github.com/supabase/realtime/blob/v2.144.0/mix.exs
https://github.com/supabase/realtime/blob/v2.144.0/config/runtime.exs

Elixir template copyright 2021 The Elixir Team and 2012 Plataformatec, licensed
under Apache-2.0; the complete upstream license is `LICENSE.elixir`.
Supabase Realtime is also Apache-2.0 licensed.

The complete launcher, environment and runtime configuration bytes were also verified directly in official v2.144.0 linux/amd64 image manifest `sha256:5dd66b136b0aa93e42450946d88c793c24b1ea876db249295c1e5df80ef9f514`. The launcher and environment retain their earlier hashes; only runtime configuration and release paths change.
