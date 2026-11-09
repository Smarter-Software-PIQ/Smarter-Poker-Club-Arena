# tests/a-satellite-name-survives-the-weekly-terms.law.test.ts

Dan 2026-11-08: a satellite is named "Satellite Into <target>" and no event says "0 GTD". On INSERT, tournaments_creation_guard stamps Midway weekly rows with their catalog terms, name included, after the first copy trigger has run; the law pins that the copy rules also run on INSERT from a trigger that sorts after the creation guard, so the catalog terms are applied first and the copy rules apply to what they produce.
