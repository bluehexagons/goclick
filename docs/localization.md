# Game localization

See the [player guide](player.md#controls-and-settings) for choosing a language.

The header language selector translates the main game: account/local navigation,
click totals, streaks, timestamps, pending/save/cooldown feedback, icon tooltips
and accessible names, floating click feedback, control instructions, achievement
filters and unlock messages, and the Share dialog and copied text. Options
translates audio profiles and descriptions, motion settings, local save tools
and status messages, volume percentages, and simulated ping choices. Pending
and lingering feedback follows language changes without replaying animations
or save acknowledgements. Local ping feedback explicitly identifies simulated
timings. If the share preview changes
during a clipboard write or after a successful copy, the dialog asks for another
copy rather than claiming the updated text is already on the clipboard.
The landing page, sign-in/signup forms, detailed game and storage notes,
administration, achievement names and hints, and some badge requirements are in
English. English technical notes and badge text carry their own language and
direction.

The supported languages are English, Simplified Chinese, Spanish, Arabic, Hindi,
Indonesian, Brazilian Portuguese, French, Japanese, Russian, and German. The
selector displays circular flags alongside native language names and marks the
current choice. Its flag and label columns align with the trigger, and each name
retains its own language and direction. The header wraps on narrow screens.
Chinese and Portuguese each use one written variant. Arabic uses right-to-left
game, navigation, and dialog layout. The [Circle Flags artwork](https://github.com/HatScripts/circle-flags/tree/v2.8.0)
is served locally from [the SVG sprite](../internal/webapp/web/language-flags.svg).

## Why these languages

Prioritize people using the Internet, rather than the language of website home
pages or crawlers. There is no universal public, bot-filtered HTTP traffic ranking
by human language; a site's traffic also cannot stand in for all Internet users.
This first set uses broad audience estimates as a practical proxy:

- [Internet World Stats, March 2020](https://www.internetworldstats.com/stats7.htm)
  identifies ten large Internet-language audiences: English, Chinese, Spanish,
  Arabic, Indonesian/Malay, Portuguese, French, Japanese, Russian, and German.
  This older source is also reproduced in
  [Wikipedia's Internet users by language](https://en.wikipedia.org/wiki/Languages_used_on_the_Internet#Internet_users_by_language).
  We provide Indonesian, rather than treating Indonesian and Malay as the same
  translation.
- [OBDILCI's July 2025 model and methodology](https://www.obdilci.org/projects/main/)
  consider connected first/second-language speakers and multilingual use, and
  support including Hindi alongside those audiences. These are estimates with
  substantial uncertainty, not an exact human-request ranking.

This is an initial coverage decision, not a claim of an exact current top eleven
or a precise percentage of human traffic covered. Revisit it using privacy-safe
aggregate language preferences if Go Click has representative audience evidence.
Do not collect extra gameplay telemetry just to choose translations.

## Preferences and button surprises

An explicit selection is stored independently of game saves in
`goclick.language.v1`. On first use, match the browser's language preferences in
order, falling back to English. Regional browser tags match the available base
language. The choice applies immediately, synchronizes across tabs, and still
works for the current visit when storage cannot be written. Changing language
never sends an account request or changes the online/local save mode.

When the button label matches the UI language, an enabled game-button activation
rolls a 2% chance to change its visible label to another supported language.
The next activation always restores the UI language, without rolling another
surprise. A UI-language change also resets the label immediately.
Rapid intervals under 350 ms add 0.12 to an activity value, capped at 1;
the value decays exponentially with a 900 ms time constant. The chance is
`2% + 6% × activity`, at most 8%, and drops back toward 2% after a pause.

This is visual feedback only: it does not add clicks, replay failed saves,
increase request budgets, or change the selected/persisted UI language. Each
label has its own language and direction; the button's accessible action stays
in the UI language. Both the CSS fallback and WebGL lettering update, including
when motion is reduced. The canvas fits long text inside the button face.

## Extending translations

- `frontend/messages.ts` and `frontend/option-messages.ts` define English messages
  and complete, type-checked catalogs per language. Keep matching interpolation
  fields in every translation.
  Translate complete messages; avoid concatenating grammatical fragments. Use
  `Intl` for numbers, dates and grammatical units. Initial translations should
  receive native-speaker review as the language set develops.
- `frontend/i18n.ts` owns locale matching, persistence helpers, formatting and
  change listeners. Add language codes, native names, directions and flag symbol
  IDs to its registry. `frontend/language-picker.ts` renders the header menu.
  Screens can subscribe to language changes without importing game state.
- Mark text-only leaves with `data-i18n="key"`. Mark tooltips and accessible names
  with `data-i18n-title` and `data-i18n-aria-label`. Keep SVGs and inputs outside
  text replacement nodes. `data-game-language` applies language and direction to
  a translated scope. The renderer inserts text, never HTML.
- Translate dynamic state with `message()` and repaint it when language changes.
  Keep numeric game state separate from formatted text, so localized digits and
  grouping separators cannot affect request ordering or counter comparisons.
- Add tests for catalog coverage, placeholders, fallback, state preservation and
  any new screen behavior. Rebuild and commit embedded JavaScript with its source
  using the [README verification commands](../README.md#test). The optional
  [browser checks](frontend.md#browser-regressions) cover every language at
  desktop/mobile sizes, localized Options, Arabic sharing, preference
  persistence, and restoring the button’s selected language on the next click.
