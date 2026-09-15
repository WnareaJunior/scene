# Product

## Register

product

## Platform

ios

## Users

College students and young adults deciding what to do tonight. They open Scene standing in a dorm room or apartment with friends, phone in hand, often at night — short sessions, quick decisions, low patience for forms. Hosts are the same people wearing a different hat: someone throwing a party who wants the right crowd to find it without blasting a public link.

## Product Purpose

Scene is a map-based party and event discovery app. Users browse nearby parties on a live map or a draggable feed sheet, RSVP in one tap, and create their own events with a photo, address autocomplete, and start time. Success for v1: a user opens the app and knows within seconds what's happening near them tonight — and a host can post a party in under a minute.

## Positioning

See tonight on a map. Every screen reinforces live, spatial, right-now discovery — not a searchable database of listings.

## Brand Personality

Underground, exclusive, raw. The app should feel like knowing the right people — word-of-mouth energy, not a commercial marketplace. Dark, minimal surfaces; a single cyan accent is the light in the room. Confidence over decoration; nothing begs for engagement.

## Anti-references

- Eventbrite and ticketing sites: corporate listings, ticket tiers, checkout flows, beige commerce UI.
- Instagram-style feed clones: infinite-scroll engagement bait, stories, like-counts as decoration.
- Campus-app clip-art energy: mascots, confetti, bubbly rounded everything, patronizing tone.

## Design Principles

- **The map is the home.** Discovery is spatial. Screens and sheets orbit the map; nothing should bury it under list-first navigation.
- **Fast like a text, not a form.** RSVPing and posting a party compete with sending a group chat message. Every required field and modal must earn its place.
- **Dark is the venue.** The UI is night-native: near-black surfaces are the setting, electric cyan (#22d3ee) is the accent light. Never flood a screen with bright chrome. See DESIGN.md §2; `frontend/src/constants/colors.js` is the authoritative palette, and the two accents that came before it are retired.
- **Word of mouth, not marketplace.** No commerce patterns, no engagement metrics as ornament. The product feels passed hand-to-hand.
- **Gestures must feel physical.** Sheets, swipes, and map moves are the core interaction language; they must track the finger and settle naturally. A janky drag breaks the spell faster than a missing feature.

## Accessibility & Inclusion

Partly addressed. The text-contrast pass happened when the palette was extracted to `frontend/src/constants/colors.js`: #555555 and #666666 measured 2.3–3.4:1 on Scene's surfaces and were replaced by Ink Secondary (#8e8e93, ≥4.5:1 on all four dark surfaces) and Ink Faint (#6e6e73, ≥18pt or decorative only).

Still deferred: VoiceOver labels and Reduce Motion support. Revisit after colleague beta feedback.
