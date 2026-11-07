/**
 * The AI-opponent disclosure (Dan, 2026-10-25).
 *
 * Horses play under ordinary player names and the table never says which
 * seats they hold (CLAUDE.md 10.5). Players are told once, up front, that AI
 * opponents may be seated: on the sign-up form, in the Terms of Service page
 * and in the acceptance modal every player passes before Club Arena opens.
 *
 * One disclosure, one place. tests/ai-opponents-are-disclosed.law.test.tsx
 * fails if any of the three surfaces stops showing it.
 *
 * 2026-11-07: horses now also wait on waiting lists, move between games, keep
 * regular hours, buy in, top up, rebuy and sit out, exactly as a person may.
 * The disclosure names those, so it still covers everything they do, and
 * still says nothing about which accounts they are.
 */
export const AI_OPPONENTS_DISCLOSURE =
  'Tables May Include AI Opponents Run By Smarter.Poker. Like Any Player, They Buy In, Top Up, Rebuy, Sit Out, Join Waiting Lists, Move Between Games And Keep Regular Hours. They Play Under Ordinary Player Names, And We Do Not Say Which Seats They Hold.';
