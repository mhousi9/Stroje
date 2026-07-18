# Údržba strojů — PWA

Offline aplikace pro evidenci strojů, závad a řešení. Funguje jako appka po instalaci na plochu telefonu, data se ukládají přímo v telefonu (IndexedDB).

Obsahuje už přednahraná data ze souboru `Údržba.xlsx` (28 strojů/kategorií, přes 1000 poznámek, ~88 fotek).

## Nahrání na GitHub Pages

Appka je záměrně udělaná tak, že **žádné složky nepotřebuje** — všechny soubory (ikony, fotky) jsou v jedné hromadě vedle sebe. To je důležité, protože nahrávání z mobilu přes GitHubovo webové rozhraní neumí zachovat strukturu složek — vždy to všechno nahraje na plocho. Tady žádný problém nehrozí, protože appka žádné složky nečeká.

1. Na [github.com](https://github.com) vytvoř nový **veřejný** repozitář, např. `udrzba`.
2. Přes **"Add file → Upload files"** vyber/přetáhni **úplně všechny soubory z této složky najednou** (žádné podsložky v ní nejsou — je to schválně). U velkého počtu souborů (je jich přes 90) to může jít nahrávat postupně po dávkách, to je v pořádku, klidně nahraj víc menších dávek za sebou.
3. Zkontroluj, že se nahrálo opravdu vše — v repozitáři by mělo být `index.html`, `app.js`, `data.js`, `styles.css`, `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png` a cca 90 souborů `.jpg`.
4. V repozitáři jdi do **Settings → Pages**.
5. U "Source" vyber **Deploy from a branch**, branch `main`, složka `/ (root)`. Ulož.
6. Za chvíli se objeví adresa typu `https://TVOJE-JMENO.github.io/udrzba/`. Otevři ji na mobilu.

## Instalace na plochu telefonu

**Android (Chrome):** otevři odkaz → tři tečky vpravo nahoře → **Přidat na plochu**.

**iPhone (Safari):** otevři odkaz → tlačítko sdílet (čtvereček se šipkou) → **Přidat na plochu**.

Appka se pak chová jako normální aplikace (vlastní ikona, běží na celou obrazovku, funguje i bez signálu — data i fotky ze zálohy jsou nahrané v appce).

## Jak appka funguje

- **Domovská obrazovka** — dlaždice se stroji, nahoře vyhledávání přes všechny stroje a poznámky najednou.
- **Detail stroje** — seznam poznámek/závad k danému stroji, tlačítko **+** dole vpravo přidá nový záznam.
- **Nový/upravovaný záznam** — text + fotky (foťák nebo galerie) + videa.
- **Přidat stroj** — tlačítko dole na domovské obrazovce.
- **Ikona ⇅ nahoře** — záloha dat: stažení JSON souboru se vším (texty, fotky, videa) a jeho zpětné nahrání. Doporučeno dělat pravidelně, protože appka nemá server — data žijí jen v telefonu, na kterém je appka nainstalovaná.

## Důležité omezení

Protože jde o čistě statickou appku na GitHub Pages (bez vlastního serveru/databáze), **data se needitují mezi více telefony automaticky**. Pokud appku používá víc lidí na víc telefonech, každý má svoje vlastní data. Řešením je pravidelně dělat zálohu (⇅ nahoře) a tu sdílet/importovat na ostatních zařízeních — nebo appku časem rozšířit o cloudové úložiště, pokud by to bylo potřeba.
