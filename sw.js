const CACHE_NAME = 'udrzba-cache-v12';
const PRECACHE_URLS = ["./", "./index.html", "./app.js", "./data.js", "./styles.css", "./manifest.json", "./icon-192.png", "./icon-512.png", "./Barva_46.jpg", "./Barva_47.jpg", "./Barva_48.jpg", "./Barva_49.jpg", "./Barva_50.jpg", "./Barva_51.jpg", "./Corefin_12.jpg", "./Corefin_13.jpg", "./Corefin_15.jpg", "./Corefin_16.jpg", "./Corefin_17.jpg", "./Corefin_18.jpg", "./Elektro_70.jpg", "./Elektro_71.jpg", "./Fin_7.jpg", "./Fin_8.jpg", "./Fin_9.jpg", "./Helium_19.jpg", "./Helium_20.jpg", "./Helium_21.jpg", "./Helium_22.jpg", "./Helium_23.jpg", "./Helium_24.jpg", "./Helium_25.jpg", "./Helium_28.jpg", "./Helium_33.jpg", "./Helium_34.jpg", "./Helium_35.jpg", "./Helium_36.jpg", "./Helium_37.jpg", "./Helium_38.jpg", "./Helium_39.jpg", "./Helium_40.jpg", "./Helium_41.jpg", "./Helium_42.jpg", "./Helium_43.jpg", "./Helium_44.jpg", "./Helium_45.jpg", "./Kotelna_82.jpg", "./Kotelna_83.jpg", "./Kotelna_84.jpg", "./Kotelna_85.jpg", "./Kotelna_86.jpg", "./Kotelna_87.jpg", "./Kotelna_88.jpg", "./Kotelna_89.jpg", "./Kotelna_90.jpg", "./Nové_modely_-_rozměr_68.jpg", "./Nové_modely_-_rozměr_69.jpg", "./Ohýbačka_60.jpg", "./Ohýbačka_61.jpg", "./Pec_62.jpg", "./Pec_63.jpg", "./Pec_64.jpg", "./Pec_65.jpg", "./Po_výpadku_1.jpg", "./Po_výpadku_2.jpg", "./Po_výpadku_3.jpg", "./Po_výpadku_4.jpg", "./Po_výpadku_5.jpg", "./Profuk_66.jpg", "./Profuk_67.jpg", "./Příprava_52.jpg", "./Rozvodna_100.jpg", "./Rozvodna_101.jpg", "./Rozvodna_91.jpg", "./Rozvodna_92.jpg", "./Rozvodna_93.jpg", "./Rozvodna_94.jpg", "./Rozvodna_95.jpg", "./Rozvodna_96.jpg", "./Rozvodna_97.jpg", "./Rozvodna_98.jpg", "./Rozvodna_99.jpg", "./Různé_102.jpg", "./Různé_103.jpg", "./Sessler_58.jpg", "./Sessler_59.jpg", "./Čerpačka_72.jpg", "./Čerpačka_73.jpg", "./Čerpačka_74.jpg", "./Čerpačka_75.jpg", "./Čerpačka_76.jpg", "./Čerpačka_77.jpg", "./Čerpačka_78.jpg", "./Čerpačka_79.jpg", "./Čerpačka_80.jpg", "./Čerpačka_81.jpg", "./Řezačka_10.jpg", "./Řezačka_11.jpg"];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((resp) => {
        if (resp && resp.status === 200 && resp.type === 'basic') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return resp;
      }).catch(() => cached);
    })
  );
});
