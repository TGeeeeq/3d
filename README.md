# Trosečníci – terénní aplikace

Sdílená terénní aplikace pro [ČSOP Trosečníci](https://www.csoptrosecnici.cz). Mobilní PWA pro
práci v terénu na revitalizovaném toku **Rudoltička** (u Rudoltic / Ostrova) a na dalších
spravovaných lokalitách v okruhu **20 km od Ostrova**.

Data jsou **živá a sdílená mezi všemi členy týmu** a bezpečně uložená na serveru (Vercel Blob,
privátní úložiště). Každý se přihlásí jedním týmovým kódem a **svým jménem**; všechno, co kdokoliv
zapíše, vidí celý tým **barevně odlišené podle autora** (filtr „Vše / Jen moje“).

**Automatické ukládání:** zápisy i trasy se ukládají samy – hned se zobrazí a na pozadí odešlou do
DB. Bez signálu počkají ve frontě v zařízení a odešlou se samy, jakmile je připojení (offline-first).
Nahrávaná trasa se průběžně zálohuje a přežije i zavření appky.

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

Každý člen týmu má **vlastní profil s vlastním heslem** (rozešle koordinátor). Stačí zadat **heslo** –
appka podle něj sama pozná, kdo se přihlásil (Tonda, David, Janča). Přihlášení pamatuje 30 dní.

Záložní možnost: kdo zná **sdílený týmový kód**, přihlásí se jím a doplní si jméno ručně.

Hesla nejsou uložená v tomto repozitáři. Jsou v proměnných prostředí projektu na Vercelu
(`TEAM_MEMBERS`, `TEAM_ACCESS_CODE`).

## Architektura

| Vrstva | Technologie |
| --- | --- |
| Frontend | Statická PWA – vanilla JS (ES moduly), Leaflet + Geoman pro mapu |
| Backend | Vercel Serverless Functions (`/api/*`, Node.js 22) |
| Úložiště | **Vercel Blob** (privátní) – každý záznam = 1 JSON blob, média (hlas/kresba) jako bloby |
| Autentizace | Pojmenované profily s vlastním heslem (+ záložní sdílený kód) → HMAC-podepsaná `httpOnly` session cookie |
| Hosting | Vercel (projekt `ochranar`, napojený na GitHub repo) |

Datové kolekce: `notes`, `tracks`, `diary`, `time`, `finance`, `rewards`, `localities`.
Každý záznam má autora, čas vzniku a úpravy. Klient drží lokální cache a periodicky se synchronizuje
(„živá“ data napříč uživateli).

### API přehled

- `POST /api/login` `{code}` (profil dle hesla) nebo `{code,name}` (záložní týmový kód) → nastaví session cookie · `POST /api/logout` · `GET /api/me`
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
| `TEAM_MEMBERS` | pojmenované profily a jejich hesla: `Jméno:heslo,Jméno2:heslo2` |
| `TEAM_ACCESS_CODE` | záložní sdílený přístupový kód týmu |

**Změna profilů / hesel** (`TEAM_MEMBERS`):

```bash
vercel env rm TEAM_MEMBERS production
vercel env add TEAM_MEMBERS production    # zadej: Jméno:heslo,Jméno2:heslo2,…
vercel --prod                             # nové nasazení
```

Stejně se mění i záložní `TEAM_ACCESS_CODE`. Heslo určuje, kdo se přihlásí, takže **jméno
profilu neměň**, pokud chceš zachovat dosavadní záznamy daného člověka (vážou se přes jméno autora).

## Bezpečnost a poznámky

- Veškerá data i média jsou přístupná **jen přihlášeným členům týmu** (privátní Blob, ověření na serveru).
- Jde o **sdílený týmový model důvěry** – každý přihlášený může zapisovat i mazat společná data.
- Záznam má limit 256 kB, nahrávané médium 12 MB.
- Pro vyšší zabezpečení doporučeno: silná hesla v `TEAM_MEMBERS` a jejich občasná obměna.

---

Vznik aplikace: rozšíření původní „interaktivní mapy poznámek“ Lukávky na plnohodnotný sdílený
terénní nástroj týmu ČSOP Trosečníci.
