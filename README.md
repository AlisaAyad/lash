# AA Lashstudio – online afspraken

**Wat de website doet**
- Klanten kiezen een lashlift en een vrije tijd en boeken direct.
- De klant krijgt meteen een **bevestigingsmail** (met de afspraak als bijlage voor de agenda) en **een dag van tevoren een herinnering**.
- Jij krijgt bij elke boeking een **e-mailmelding**. Tik op de bijlage en de afspraak staat in je agenda.
- In de **studio-agenda** (`studio.html`) zie je alle afspraken per week. Met de knop **Abonneer in Apple Agenda** komen alle afspraken vanzelf in de Agenda-app op je iPhone of Mac. Bij elke afspraak zit ook een knop **Zet in Apple Agenda**.
- Annuleren, openingstijden, prijzen, vakantiedagen, adres en telefoonnummer regel je in de studio-agenda.

## Waarom werkt de agenda nog niet?

De website zelf staat op GitHub, maar GitHub kan geen afspraken bewaren of e-mails versturen. Daarvoor koppel je twee gratis diensten:

- **Supabase**: bewaart de afspraken en verstuurt de mails op het juiste moment.
- **Brevo**: verstuurt de e-mails (gratis tot 300 per dag).

Tot die koppeling er is, draait de site in **demomodus**: op `studio.html` klik je op **Demo bekijken** en zie je voorbeeldafspraken.

> Open de site via `https://<gebruikersnaam>.github.io/<repository>/`, niet via github.com. Op github.com zie je alleen de code.

Reken op ongeveer 45 minuten voor alle stappen. Je hoeft niets te programmeren, alleen dingen te kopiëren en te plakken.

---

## Stap 1 – Nieuwe bestanden op GitHub zetten

Heb je de vorige versie al geüpload? Open je repository, klik op **Add file → Upload files** en sleep alle bestanden en mappen uit deze zip er opnieuw in. Bestaande bestanden worden vervangen. Klik op **Commit changes**.

- Op een Mac zijn `.github` en `.nojekyll` verborgen. Druk in Finder op **Cmd + Shift + .** om ze te tonen en sleep ze mee.
- Staat GitHub Pages nog niet aan? Ga naar **Settings → Pages**, kies **Deploy from a branch**, branch **main**, map **/ (root)** en klik op **Save**.

## Stap 2 – Supabase: de database

1. Maak een gratis account op [supabase.com](https://supabase.com) en klik op **New project**. Kies als regio **Central EU (Frankfurt)**.
2. Open **SQL Editor**, plak de hele inhoud van `supabase/setup.sql` en klik op **Run**.
3. Maak je inlog voor de studio-agenda:
   - **Authentication → Users → Add user → Create new user**. Vul je e-mailadres en een sterk wachtwoord in, en vink **Auto Confirm User** aan.
   - Terug in de **SQL Editor**, met jouw e-mailadres:
     ```sql
     insert into public.admins (user_id)
     select id from auth.users where email = 'jouw@email.nl';
     ```
4. Zet aanmelden voor anderen uit: **Authentication → Sign In / Providers**, en zet **Allow new users to sign up** uit.

## Stap 3 – Brevo: e-mail

1. Maak een gratis account op [brevo.com](https://www.brevo.com).
2. Ga naar **Senders, Domains & Dedicated IPs → Senders → Add a sender**. Vul het e-mailadres in waar de mails vandaan komen, bijvoorbeeld je studio-mailadres, en bevestig het via de mail die je krijgt.
3. Ga naar **SMTP & API → API Keys → Generate a new API key** en kopieer de sleutel (begint met `xkeysib-`).

Heb je een eigen domein (bijv. `aalashstudio.nl`)? Voeg het dan bij Brevo toe onder **Domains**. Mails komen dan minder snel in de spam.

## Stap 4 – Supabase: geheimen invullen

Ga in Supabase naar **Edge Functions → Secrets** en voeg deze toe:

| Naam | Waarde |
|---|---|
| `BREVO_API_KEY` | de sleutel uit stap 3 |
| `MAIL_FROM` | het afzender-adres uit stap 3 (precies zoals bevestigd bij Brevo) |
| `STUDIO_EMAIL` | het adres waar jij de meldingen van nieuwe afspraken wilt krijgen |
| `SITE_URL` | *(optioneel)* het adres van je website, bijv. `https://jouwnaam.github.io/aalashstudio` |

## Stap 5 – Serverfuncties online zetten (via GitHub)

1. Maak in Supabase een toegangstoken: [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token**.
2. Ga in je GitHub-repository naar **Settings → Secrets and variables → Actions → New repository secret** en voeg toe:
   - `SUPABASE_ACCESS_TOKEN`: het token uit punt 1
   - `SUPABASE_PROJECT_ID`: de code uit je Supabase-adres (`https://`**`abcdefghijkl`**`.supabase.co`)
3. Ga naar het tabblad **Actions**, kies **Serverfuncties uitrollen** en klik op **Run workflow**. Na ongeveer een minuut verschijnt er een groen vinkje.

## Stap 6 – Herinneringen elk uur laten versturen

Open `supabase/herinneringen.sql`, vervang `JOUWPROJECT` door je projectcode (dezelfde als in stap 5), plak het in de **SQL Editor** en klik op **Run**.

## Stap 7 – Website koppelen

1. Ga in Supabase naar **Project Settings → API Keys** (of **API**). Kopieer de **Project URL** en de **anon public**- of **publishable**-sleutel.
2. Open op GitHub `assets/config.js`, klik op het potlood en vul beide in:
   ```js
   SUPABASE_URL: "https://abcdefghijkl.supabase.co",
   SUPABASE_KEY: "eyJhbGciOi…",
   ```
3. Klik op **Commit changes**. Na een minuut is de site live.

## Stap 8 – Afmaken en testen

1. Open `…/studio.html` op je **iPhone** en log in.
2. Vul bij **Instellingen** je adres en telefoonnummer in (die komen in de mails) en klik op **Opslaan**.
3. Tik op **Abonneer in Apple Agenda** en daarna op **Abonneer**. Voortaan staan alle afspraken vanzelf in je Agenda-app.
4. Maak op de boekingspagina een testafspraak met je eigen e-mailadres. Je krijgt twee mails: de bevestiging voor de klant en de melding voor jou.
5. Annuleer de testafspraak in de studio-agenda.

---

## Goed om te weten

- **Hoe snel komt een afspraak in Apple Agenda?** Via het abonnement na 5 tot 15 minuten. Zet op de iPhone bij **Instellingen → Agenda → Accounts → Nieuwe gegevens ophalen** het ophalen op "Elke 15 minuten". Wil je hem meteen? Tik op de bijlage in de meldingsmail of gebruik **Zet in Apple Agenda** bij de afspraak.
- **Herinneringen** gaan 24 uur van tevoren. Wie binnen een dag voor de afspraak boekt, krijgt alleen de bevestiging.
- **Dubbel boeken kan niet.** Ook niet als twee klanten precies tegelijk dezelfde tijd kiezen.
- **Eigen afspraken of vrije dagen:** zet vakantiedagen in de studio-agenda onder *Dagen dicht*. Wil je dat afspraken die je zelf in iCloud zet ook blokkeren, zie dan "Extra" hieronder.
- **Bij een mailfout** staat er een ⚠ bij de afspraak in de studio-agenda, met de knop **Bevestiging opnieuw sturen**.
- **Privacy (AVG):** je bewaart namen, e-mailadressen en telefoonnummers. Vermeld op je site dat je die alleen voor de afspraak gebruikt.

## Extra (optioneel): iCloud direct koppelen

Hiermee komen afspraken binnen enkele seconden in iCloud, en tellen afspraken die jij zelf in iCloud zet als bezet op de website.

1. Maak in Apple Agenda een aparte agenda, bijv. **AA Lashstudio**.
2. Ga naar [account.apple.com](https://account.apple.com) → **Inloggen en beveiliging → App-specifieke wachtwoorden** en maak er een aan.
3. Voeg in Supabase bij **Edge Functions → Secrets** toe: `ICLOUD_USERNAME` (je Apple ID), `ICLOUD_APP_PASSWORD` en `ICLOUD_CALENDAR` (de naam van de agenda). Optioneel: `ICLOUD_BUSY_CALENDARS` met andere agenda's die ook als bezet tellen, bijv. `Thuis`.

Gebruik je dit, zet dan het abonnement uit stap 8 niet ook aan. Anders zie je elke afspraak twee keer.

## Bestanden

```
index.html                  boekingspagina voor klanten
studio.html                 studio-agenda
assets/config.js            koppeling met Supabase (stap 7)
supabase/setup.sql          database (stap 2)
supabase/herinneringen.sql  elk uur herinneringen (stap 6)
supabase/functions/         serverfuncties: vrije tijden, boeken, e-mails, herinneringen, agenda-abonnement
.github/workflows/          zet de serverfuncties automatisch online (stap 5)
```
