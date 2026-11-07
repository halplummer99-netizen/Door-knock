# Door Knock: setup guide

A phone app (PWA) for door-knocking runs: plan a driving route, log every door, export a CSV for the dashboard.
There is no server. Everything is stored on the phone.

You only do these steps once. Allow about 20 minutes.

---

## 1. Put the app online (GitHub Pages, free)

1. Go to **github.com** and sign up (or sign in).
2. Click **+ → New repository**. Name it `door-knock`, set it to **Public**, tick **Add a README**, and click **Create repository**.
3. In the new repository, click **Add file → Upload files**. Drag in **everything in this `door-knock-app` folder**, including the `icons` folder:
   `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `icons/`. (`SETUP.md` is optional.)
   Click **Commit changes**.
4. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**. Click **Save**.
5. Wait 1–2 minutes and refresh that page. It shows your address, something like
   `https://YOUR-NAME.github.io/door-knock/`. That's your app.

(Netlify works too: drag the folder onto **app.netlify.com/drop**. Your address will then be `https://SOMETHING.netlify.app/`.)

---

## 2. Create your Google Maps API key

1. On a computer, go to **console.cloud.google.com** and sign in with your Google account.
2. At the top, click the project picker → **New project**. Name it `Door Knock` → **Create**. Make sure it's selected.
3. Google asks for a billing account (a card). The free monthly credit covers normal door-knocking use.
   To be safe, go to **Billing → Budgets & alerts** and set a budget of £10 with an email alert.
4. Go to **APIs & Services → Library**. Search for and **Enable** each of these:
   - **Maps JavaScript API** (loads Google's address lookup in the app)
   - **Geocoding API** (turns addresses into map pins)
   - **Routes API** (works out the best driving order)
5. Go to **APIs & Services → Credentials → + Create credentials → API key**. Copy the key it shows.

### Lock the key to your site (important)

The key is visible to anyone who opens the site, so restrict it so it only works from your app:

1. On the Credentials page, click the key's name to edit it.
2. **Application restrictions → Websites**. Add your site with `/*` on the end, using just the domain:
   - GitHub Pages: `https://YOUR-NAME.github.io/*`
   - Netlify: `https://SOMETHING.netlify.app/*`
3. **API restrictions → Restrict key**. Tick only **Maps JavaScript API**, **Geocoding API** and **Routes API**.
4. Click **Save**. It can take up to 5 minutes before the key starts working.

---

## 3. Install it on your phone

1. On your Android phone, open your app address in **Chrome**.
2. Tap **⋮ → Add to Home screen → Install**.
3. Open **Door Knock** from the home screen. It opens on **Settings**: paste your API key, check the start/end points (CM3 5ZF by default), tap **Save**, then **Test my key**. You want to see "✓ Key works".

---

## Using it

1. **Plan a run** (needs signal): paste addresses one per line, or tap **Import CSV run list**. Tap **Plan route**.
2. **Check your route**: red = not found (edit and Retry, or delete). Orange = might be in the wrong spot.
   Drag ☰ to reorder. **Open full route** sends it to Google Maps (split into parts if there are more than 9 stops).
3. **Start knocking**: one card per door. Tap an outcome; for *Answered*, fill in name, phone, situation and timescale.
   Swipe right or tap **Next** to move on, swipe left or **Back** to go back. **Stops** shows the whole list, so you can jump around.
   Everything saves on the phone as you tap, with or without signal.
4. **Finish** shows the summary. Tap **Share CSV** to send it to email, WhatsApp, Drive and so on, or **Download CSV**.
   Past runs are under **Runs**, which can also export every run in one CSV.

### Sharing into the app

Once installed, **Door Knock** appears in Android's share menu:

- Share **text** (a WhatsApp message, a note, a Google Maps place) and the addresses are added to the address box. Links are removed, and an address split over several lines is joined up at its postcode.
- Share a **CSV file** (from Drive, Gmail, Files…) and it's imported like the Import button.

If the share option doesn't appear, remove the app from the home screen and add it again.

### CSV import format

Any of these work (header row optional for the first one):

- `address, postcode`
- a column called `address` (postcode inside it or in a `postcode` column)
- the weekly SPRIFT lists saved as CSV: `first_line`, `street`, `postcode`

### CSV export columns (always this order)

`run_id, run_date, stop_order, address, postcode, lat, lng, outcome, contact_name, contact_phone, situation, timescale, notes, hot_lead, follow_up_date, neighbours_leafleted_count, neighbours_leafleted_numbers, logged_at, christmas_card, door_at, gps_lat, gps_lng, gps_accuracy_m, metres_from_door, left_at, minutes_at_door, run_minutes, run_steps, run_miles`

Any new column is added on the end, so the existing columns never move.

| column | values |
|---|---|
| outcome | `answered`, `no_answer_leaflet`, `no_cold_callers`, `other`, `not_logged` |
| situation | `thinking_of_selling`, `not_now`, `just_sold`, `renting` (blank if not answered) |
| timescale | `0-3 months`, `3-6 months`, `6-12 months`, `12+ months`, `Unknown` |
| notes | for *Other*, this is the "what happened" text |
| hot_lead | `TRUE` / `FALSE` |
| follow_up_date, run_date | `YYYY-MM-DD` |
| logged_at | when that door was last changed, e.g. `2026-11-02T10:15:03+00:00` |
| christmas_card | `TRUE` / `FALSE`: tapped **Send them a Christmas card** on that door |
| door_at | the moment of the **first outcome tap** on that door. Notes, leaflets and swiping never change it |
| gps_lat, gps_lng, gps_accuracy_m | where the phone was at that tap, and how accurate the fix was. Blank if there was no fix |
| metres_from_door | distance from that GPS point to the address's map pin |
| left_at | when you first swiped or moved on from that door |
| minutes_at_door | time from `door_at` to `left_at`, including any neighbour leaflets |
| run_minutes, run_steps, run_miles | whole-run figures, repeated on every row of the run, so don't add them up across rows. `run_minutes` runs from the first door to leaving the last door. Steps and miles are what you typed in from your watch |

### Tracking a run

Tracking needs no setup beyond allowing location the first time the app asks. Each door is stamped when you first tap its outcome, so tap at the door and swipe when you leave. Tapping the selected outcome again clears the stamp, ready for a fresh tap.

The run summary shows times, minutes per door, doors per hour and a door-by-door list with a map link for each stamp. Anything over 100 m from the address shows in red. Tracking only happens at those taps: the app does not follow you between doors.

For steps and distance, start a **Walk** on your watch at the first door and stop it at the last. Type the totals into **From your watch** on the run summary.

### Christmas card list

On any door card, tap **Send them a Christmas card**. Everyone you've ticked, across every run, appears under
**Runs → 🎄 Christmas card list**, sorted by postcode. A house only appears once, and anyone without a name is listed as
"The Occupier". **Share list as CSV** gives `name, address, postcode, added_on, run_id`, ready for a label mail merge.
**Copy names & addresses** copies them as address blocks. Tap ✕ to take someone off the list.

### Updating the app later

Upload the changed files to the GitHub repository again and change `VERSION` at the top of `sw.js`
(e.g. `dk-v1` → `dk-v2`). The phone picks up the new version the next time the app is opened twice.
