# Product

<!-- impeccable:product-schema 1 -->

> Written overnight on 2026-11-04 while Fabian was asleep, from the brief and from the work done with him in this project. Facts marked *(déduit)* are inferred and still need his confirmation.

## Platform

web

## Users

- **Équipe City-Drop** (Fabian, Jérôme and the team): plan the vehicles to treat each day, send requests to subcontractors, follow their answers, check their invoices at the end of the month. Mostly on a computer at the office, sometimes on a phone *(déduit)*.
- **Prestataires** (ALLO pare-brise 78, Khalid, Du sol au toit, Roag… about 7 at most): replace windshields, wash vehicles or do small interventions (check, bulb, oil, AdBlue). Use the app on a phone, outdoors, on car parks. They only see their own requests.
- **Lecture** accounts: see everything, change nothing.

## Product Purpose

One place where City-Drop asks a subcontractor to treat a fleet vehicle (a utility van identified by its plate), the subcontractor accepts and closes the job with a plate photo, and the team sees every answer without chasing anyone on WhatsApp. Success: no request is forgotten, no duplicate is sent, and the monthly provider invoice can be checked in minutes.

## Operating Context

- Requests are still often shared on WhatsApp: each request and each day's list can be copied as a ready-to-paste message.
- A Google Sheet keeps the historical windshield tracking; a script can tick the confirmed plates in it.
- Prices are hors taxe and frozen on each request; payment stays by bank transfer, outside the tool.
- Sites: Saint-Cloud, La Défense, Aulnay, Coignières, Paris-Centre *(déduit from test data; real list lives in Réglages)*.

## Capabilities and Constraints

- Static site on GitHub Pages, vanilla JS, Firebase (Firestore europe-west9, email/password accounts). No build tool beyond `node src/build.js`; no paid Firebase plan.
- Services: Pare-brise, Lavage, Intervention (Intervention only for providers flagged for it).
- Default slot 08h30–19h30. Duplicate requests (same plate, service, overlapping days) are refused.
- Push notifications to closed apps are planned (phase 3) through the Apps Script Web Push already used by the runners app.

## Brand Commitments

- Name written **City-Drop × Presta**, always with the hyphen.
- Logo: blue box van with yellow pin and check, City-Drop blue #009FE3 and yellow #FFC21A.
- Tone: French, tutoiement, plain words. Fabian is not technical: no jargon in the interface.

## Evidence on Hand

- Real fleet models (Renault Master, Opel Movano, Opel Vivaro, Fiat Ducato) and real provider names.
- No testimonials or metrics exist; do not invent any.

## Product Principles

1. **Simple before complete.** Few buttons on screen; rare tools sit one click away, never in the way *(from Fabian's brief: « qu'on soit pas perdu avec 10 000 boutons »)*.
2. **Today first.** The day's vehicles and the providers' answers are what the team opens the app for.
3. **Nothing gets lost.** Every answer is visible until someone has seen it; every request has a clear status.
4. **Phone in the car park.** The provider screen works one-handed, outdoors, with big targets.
5. **Clean and airy.** « Épuré et pas trop tassé », but without large empty areas.

## Accessibility & Inclusion

Outdoor phone use for providers: strong contrast and large touch targets *(déduit)*.
