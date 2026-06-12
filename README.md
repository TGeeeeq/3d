# Lukávka – interaktivní mapa poznámek

Terénní mapa revitalizovaného toku Lukávky u Damníkova. Nad leteckým snímkem si můžeš
přidávat barevné poznámky – body (špendlíky) i plochy (např. celý porost bodláku).

## Spuštění (GitHub Pages)

1. Otevři **Settings → Pages** tohoto repozitáře.
2. V **Source** vyber „Deploy from a branch“.
3. Vyber větev s aplikací a složku `/ (root)`, ulož.
4. Mapa pak poběží na `https://tgeeeeq.github.io/3d/`.

Na telefonu si adresu otevři v Chrome/Safari a dej **Přidat na plochu** – mapa se pak
chová jako aplikace přes celou obrazovku.

## Ovládání

- **📍 Bod** – klepni na tlačítko a pak do mapy; vyber barvu, napiš poznámku, ulož.
- **⬠ Plocha** – klepáním obtáhni plochu, ukonči klepnutím na první bod.
- Klepnutím na existující bod/plochu poznámku zobrazíš, upravíš nebo smažeš.
  U ploch jde tlačítkem **Upravit tvar** tahat za vrcholy.
- **🧭 Poloha** – ukáže modrou tečkou, kde stojíš (GPS). V menu je pak
  „Přidat bod na mé poloze“.
- **☰ Menu** – export/import poznámek (soubor GeoJSON) a návrat na celý tok.

## Data

Poznámky se ukládají do prohlížeče daného zařízení (localStorage). Pro zálohu nebo
přenos na jiné zařízení použij **Export** (stáhne `lukavka-poznamky.geojson`)
a **Import**.

## Podkladové mapy

Přepínač vpravo nahoře: letecké snímky ČÚZK (výchozí), letecké snímky Esri
a obyčejná mapa (OpenStreetMap). Pozn.: letecké snímky zatím nemusí ukazovat nové
meandry – ortofoto je starší než revitalizace; po dalším snímkování ČÚZK se podklad
zaktualizuje automaticky.
