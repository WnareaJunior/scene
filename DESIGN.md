---
name: Scene
description: Map-based party discovery for the after-dark crowd — see tonight on a map.
colors:
  sodium-amber: "#ffa028"
  amber-pressed: "#e08010"
  amber-tint: "#2b1d0a"
  amber-ink: "#1a0d00"
  void: "#000000"
  asphalt: "#0a0a0a"
  surface: "#111111"
  card: "#1a1a1a"
  border: "#2a2a2a"
  divider: "#1c1c1e"
  ink: "#ffffff"
  ink-secondary: "#8e8e93"
  ink-meta: "#666666"
  ink-hint: "#555555"
  live-green: "#22c55e"
  error-red: "#ef4444"
typography:
  title:
    fontFamily: "SF Pro (system)"
    fontSize: "22-28pt"
    fontWeight: 800
  headline:
    fontFamily: "SF Pro (system)"
    fontSize: "16-17pt"
    fontWeight: 700
  body:
    fontFamily: "SF Pro (system)"
    fontSize: "14-15pt"
    fontWeight: 400
  label:
    fontFamily: "SF Pro (system)"
    fontSize: "13pt"
    fontWeight: 600
  caption:
    fontFamily: "SF Pro (system)"
    fontSize: "11-12pt"
    fontWeight: 600
rounded:
  sm: "6px"
  md: "10px"
  lg: "12px"
  xl: "20px"
  sheet: "24px"
spacing:
  sm: "8px"
  md: "14px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.sodium-amber}"
    textColor: "{colors.amber-ink}"
    rounded: "{rounded.md}"
    padding: "15px 16px"
  button-primary-pressed:
    backgroundColor: "{colors.amber-pressed}"
    textColor: "{colors.amber-ink}"
  button-disabled:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink-meta}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "13px"
  card:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.lg}"
    padding: "14px"
  chip:
    backgroundColor: "{colors.amber-tint}"
    textColor: "{colors.sodium-amber}"
    rounded: "{rounded.xl}"
    padding: "5px 10px"
---

# Design System: Scene

## 1. Overview

**Creative North Star: "The Unlisted Map"**

Scene's interface is a city map at 2am crossed with an address that was never posted publicly. The world is near-black asphalt; the only light is Electric Cyan — the cold glow of an LED sign, or a phone screen held up in the dark — and it appears exclusively on the things that matter right now: the action you can take, the party that's live, the pin you're heading to. Everything else recedes into tonal darkness and hairline borders.

The system rejects everything PRODUCT.md rejects: no Eventbrite commerce chrome, no Instagram engagement decoration, no campus-app confetti — and no stock AI-palette accents. Components are **barely there**: flat dark surfaces, borderless where possible, content floating on black. The interface should feel passed hand-to-hand, not marketed.

**Key Characteristics:**
- One accent, used like a streetlight: sparse, cold, meaningful
- Tonal depth (black → asphalt → card) instead of shadows
- Hairline borders (#484848) as the only edge treatment
- System typography, heavy at the top (800 titles), quiet everywhere else
- Gesture-first surfaces: sheets and swipes, not chrome and buttons

## 2. Colors

A near-monochrome night palette with a single cold glow.

`frontend/src/constants/colors.js` is the authoritative source; this section
documents it. If the two ever disagree, the code is right and this file is stale.

### Primary
- **Electric Cyan** (#22d3ee): the streetlight. Primary actions (RSVP, Post event), selection states, the map crosshair and event pins, active chips, links to people. If it glows cyan, you can act on it.
- **Cyan Pressed** (#06b6d4): pressed/active state of any accent control.
- **Cyan Tint** (#062a33): the glow's spill — background for chips, tag pills, and avatar placeholders. Never for large surfaces.
- **Cyan Ink** (#001418): text/icon color *on* cyan fills. Never white on cyan — it fails contrast.

### Neutral
- **Void** (#000000): the root — profile screen, status bar wells.
- **Asphalt** (#0a0a0a): app background and detail sheets.
- **Surface** (#111111): the search sheet and secondary sheets.
- **Card** (#1a1a1a): cards, inputs, list rows.
- **Border** (#484848): hairline edges on cards and inputs.
- **Divider** (#2e2e30): list separators.
- **Handle** (#58585c): drag handles and non-text ornaments only — never text.
- **Ink** (#ffffff): titles and primary text.
- **Ink Secondary** (#8e8e93): bios, meta, counts, placeholders, labels. Passes 4.5:1 on all four dark surfaces.
- **Ink Faint** (#6e6e73): ≥18pt or decorative text only (≥3:1). Never body copy.

### Tertiary
- **Live Green** (#22c55e): exclusively the "happening right now" state. Nothing else is green.
- **Error Red** (#ef4444): errors and "Full" capacity only.
- **Scrim** (rgba(0,0,0,0.55)): the backdrop behind any sheet.

### Named Rules
**The One Streetlight Rule.** The accent appears on at most 10% of any screen. If two large cyan elements are visible at once, one of them is wrong.
**The Retired-Accent Rule.** Scene has had three accents; two are retired and must never reappear: the AI purple #a855f7 (with #7c3aed, #2a1a3e), and Sodium Amber #ffa028 (with #e08010, #2b1d0a, #1a0d00). Replace on sight.
**The Scarcity-Is-Accent Rule.** Low-capacity warnings ("3 spots left") use the accent, not a separate orange — scarcity is the glow, not an alarm.
**The Legible-Gray Rule.** #555555 and #666666 are banned as text colors: they measure 2.3–3.4:1 on Scene's surfaces. Ink Secondary is the floor for anything under 18pt.

## 3. Typography

**UI Font:** SF Pro via the system default (no custom fonts loaded)

**Character:** One family, wide weight range. Screen titles hit like flyer headlines (800); everything else stays quiet and legible. Lowercase screen titles ("create event") are a deliberate voice marker — keep them.

### Hierarchy
- **Title** (800, 22–28pt): screen titles and event names. Lowercase where the current app uses lowercase.
- **Headline** (700, 16–17pt): card titles, sheet headers.
- **Body** (400, 14–15pt): descriptions, form values, addresses.
- **Label** (600, 13pt): buttons under 15pt, chips, badges, counts.
- **Caption** (600, 11–12pt): state pills, "hosted by", metadata.

### Named Rules
**The No-Display-Font Rule.** No custom display faces, no letterspaced-uppercase eyebrows. Weight and size carry the hierarchy alone.

## 4. Elevation

Flat by doctrine. Depth is tonal — Void beneath Asphalt beneath Card — plus hairline borders. There are no box shadows anywhere in the system, and none should be added; sheets separate from the map with a backdrop scrim (rgba(0,0,0,0.55)) and their own surface color, not a drop shadow.

### Named Rules
**The No-Shadow Rule.** If a surface needs separation, change its tone or give it a hairline border. A shadow is a bug.

## 5. Components

### Buttons
- **Shape:** Softly rounded (10px); full-width for primary screen actions.
- **Primary:** Electric Cyan fill, Cyan Ink text (700, 15–16pt), 15px vertical padding.
- **Pressed:** Cyan Pressed fill. **Disabled:** Card fill, Ink Secondary text, hairline border.
- **Destructive (sign out):** Card fill, Error Red text — never a red fill.

### Chips
- **Style:** Cyan Tint background, Electric Cyan text (600, 12–13pt), pill radius (20px), 1px Electric Cyan border at 40% opacity or none.
- **State:** selected/tag chips only; chips are never navigation.

### Cards / Containers
- **Corner Style:** 12px. **Background:** Card (#1a1a1a). **Border:** 1px Border (#484848). **Shadow:** none (see Elevation). **Internal padding:** 14px.

### Inputs / Fields
- **Style:** Card background, 1px Border, 10px radius, 13px padding, Ink text, Ink Secondary placeholder.
- **Focus:** border shifts to Electric Cyan; no glow.

### Sheets (signature component)
- Bottom sheets are the app's core surface: Surface/Asphalt background, top radius 20–24px, 40×5px handle bar, backdrop scrim. Sheets must track the finger (translateY transforms only) and snap with a settle, never a jump.

### State Pills
- Border-only pills (1px colored border, 6px radius, transparent fill): Live Green for live, Electric Cyan for upcoming, Ink Secondary for past.

### Map Pins
- The chip-marker is the label: Card background, 1.5px Electric Cyan border, white event title, pointer beneath. No default pins, no callout bubbles.

## 6. Do's and Don'ts

### Do:
- **Do** keep Electric Cyan under 10% of any screen — it is the only light in the room.
- **Do** use tonal steps (Void → Asphalt → Card) and hairline #484848 borders for all separation.
- **Do** use Cyan Ink (#001418) for text on cyan fills; the pairing is the brand handshake.
- **Do** import from `frontend/src/constants/colors.js` rather than writing a hex inline.
- **Do** keep lowercase screen titles and heavy (800) title weight — that's the flyer voice.
- **Do** honor swipe-to-dismiss and finger-tracking on every sheet (PRODUCT.md: "gestures must feel physical").

### Don't:
- **Don't** use either retired accent — the AI purple #a855f7 / #7c3aed / #2a1a3e, or Sodium Amber #ffa028 / #e08010 / #2b1d0a / #1a0d00. See The Retired-Accent Rule.
- **Don't** use #555555 or #666666 for text; they fail contrast on every Scene surface.
- **Don't** ship Eventbrite energy: no ticket-tier cards, no checkout chrome, no beige commerce surfaces.
- **Don't** ship Instagram energy: no like-counts as decoration, no stories rails, no engagement-bait badges.
- **Don't** ship campus-app clip-art energy: no mascots, no confetti, no bubbly oversized radii (nothing above 24px except circles).
- **Don't** add box shadows, gradients, or glassmorphism — flat tonal darkness only.
- **Don't** put white text on amber (fails contrast) or gray text (#555) below 13pt on Card surfaces.
