# Trosečníci – terénní aplikace

Sdílená terénní aplikace pro [ČSOP Trosečníci](https://www.csoptrosecnici.cz). Mobilní PWA pro
práci v terénu na revitalizovaném toku **Lukávky u Damníkova** i na dalších spravovaných lokalitách.

Data jsou **živá a sdílená mezi všemi členy týmu** a bezpečně uložená na serveru (Vercel Blob,
privátní úložiště). Každý se přihlásí jedním týmovým kódem a svým jménem; všechno, co kdokoliv
zapíše, vidí celý tým.

## Co aplikace umí

- **🗺️ Mapa** – body a plochy nad leteckým snímkem toku. U každého zápisu se rychle volí jedna ze
  **dvou kategorií**: 🪲 *Problém / zásah* nebo 🌿 *Pozorování*. Funguje GPS poloha i export do GeoJSON.
- **🥾 Trasa** – volitelné **trackování pohybu** přes GPS s živou mapou a **počítáním nachozených metrů**.
  Uložené trasy se sčítají do týmového součtu.
- **📓 Deník** – terénní zápisky: **text, kresba** (prstem na plátno) nebo **hlasová poznámka** (nahrávání
  přes mikrofon). Vše sdílené v týmu.
- **⏱️ Hodiny & odměny** – výkaz **dobrovolnických hodin** (důležité pro reporting ČSOP) a motivační
  **body** za odpracovaný čas + nástěnka odměn.
- **💰 Finance** – jednoduchý správce **příjmů a výdajů** týmu se zůstatkem a kategoriemi.
- **📍 Lokality ve správě** – seznam spravovaných míst s rozlohou, popisem a odkazy (připraveno k rozšíření).

Aplikace je **PWA** – na telefonu ji přes „Přidat na plochu“ používáš jako běžnou appku přes celou
obrazovku a app shell funguje i offline.

## Přihlášení

Každý člen týmu zadá **své jméno** a **týmový přístupový kód** (rozešle koordinátor). Po přihlášení
appka jméno i přihlášení pamatuje 30 dní.

Kód není uložen v tomto repozitáři. Je v proměnných prostředí projektu na Vercelu (`TEAM_ACCESS_CODE`).

## Architektura

| Vrstva | Technologie |
| --- | --- |
| Frontend | Statická PWA – vanilla JS (ES moduly), Leaflet + Geoman pro mapu |
| Backend | Vercel Serverless Functions (`/api/*`, Node.js 22) |
| Úložiště | **Vercel Blob** (privátní) – každý záznam = 1 JSON blob, média (hlas/kresba) jako bloby |
| Autentizace | Sdílený týmový kód → HMAC-podepsaná `httpOnly` session cookie |
| Hosting | Vercel (projekt `ochranar`, napojený na GitHub repo) |

Datové kolekce: `notes`, `tracks`, `diary`, `time`, `finance`, `rewards`, `localities`.
Každý záznam má autora, čas vzniku a úpravy. Klient drží lokální cache a periodicky se synchronizuje
(„živá“ data napříč uživateli).

### API přehled

- `POST /api/login` `{code,name}` → nastaví session cookie · `POST /api/logout` · `GET /api/me`
- `GET|POST|PUT|DELETE /api/records?collection=<kolekce>[&id=<id>]` – CRUD záznamů (vyžaduje přihlášení)
- `POST /api/media?ext=<png|webm|…>` (binární tělo) → `{key}` · `GET /api/media?key=media/<id>.<ext>` (stream)

## Vývoj a nasazení

```bash
npm install
vercel link            # projekt ochranar (tým nechmerust-2916s-projects)
vercel env pull .env.local
vercel dev             # http://localhost:3000
```

Nasazení probíhá **automaticky při pushi do `main`** (repo je napojený na Vercel). Ruční nasazení:
`vercel --prod`.

### Proměnné prostředí (na Vercelu)

| Proměnná | Popis |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | token Blob storu `ochranar-data` (nastaveno automaticky) |
| `SESSION_SECRET` | tajný klíč pro podpis session cookie |
| `TEAM_ACCESS_CODE` | sdílený přístupový kód týmu |

**Změna týmového kódu:**

```bash
vercel env rm TEAM_ACCESS_CODE production
vercel env add TEAM_ACCESS_CODE production    # zadej nový kód
vercel --prod                                 # nové nasazení
```

## Bezpečnost a poznámky

- Veškerá data i média jsou přístupná **jen přihlášeným členům týmu** (privátní Blob, ověření na serveru).
- Jde o **sdílený týmový model důvěry** – každý přihlášený může zapisovat i mazat společná data.
- Záznam má limit 256 kB, nahrávané médium 12 MB.
- Pro vyšší zabezpečení doporučeno: silný `TEAM_ACCESS_CODE` a jeho občasná obměna.

---

Vznik aplikace: rozšíření původní „interaktivní mapy poznámek“ Lukávky na plnohodnotný sdílený
terénní nástroj týmu ČSOP Trosečníci.
