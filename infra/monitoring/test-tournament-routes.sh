#!/usr/bin/env bash
# Exercise the real Alertmanager route evaluator before accepting a deployment.
set -euo pipefail
config="$1"; shift
for severity in critical warning info; do
  for page in sms none; do
    "$@" config routes test --config.file="$config" --verify.receivers=codex-inbox \
      alertname=TournamentNeverStarted component=tournament severity="$severity" page="$page"
    "$@" config routes test --config.file="$config" --verify.receivers=codex-inbox \
      alertname=MttPlayStopped severity="$severity" page="$page"
  done
done
for name in HorseTournamentsOverdue SpinFleetProducingNothing; do
  "$@" config routes test --config.file="$config" --verify.receivers=codex-inbox \
    alertname="$name" severity=critical
done
"$@" config routes test --config.file="$config" --verify.receivers=null-receiver \
  alertname=MonitoringCanary component=tournament severity=canary
# Preserve the unrelated infrastructure escalation policy.
"$@" config routes test --config.file="$config" --verify.receivers=codex-inbox,email-critical \
  alertname=EngineScrapeDown component=engine severity=critical
# 2026-11-11: routine warnings send no email (owner decision). Critical keeps
# the email emergency path; every non-canary alert still reaches the inbox
# webhook; a warning stops at codex-inbox and cannot fall through to the
# top-level email-critical receiver.
"$@" config routes test --config.file="$config" --verify.receivers=codex-inbox \
  alertname=HostHighCpu component=host severity=warning
"$@" config routes test --config.file="$config" --verify.receivers=codex-inbox,null-receiver \
  alertname=HostInfo component=host severity=info
"$@" config routes test --config.file="$config" --verify.receivers=null-receiver \
  alertname=MonitoringCanary severity=canary
"$@" config routes test --config.file="$config" --verify.receivers=pager-sms,email-critical \
  alertname=ClusterPassErrors component=cluster severity=critical page=sms
"$@" config routes test --config.file="$config" --verify.receivers=pager-sms \
  alertname=ClusterPassSlow component=cluster severity=warning page=sms
