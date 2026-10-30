# Lekcja 1 LABA — przygotowanie do publikacji

Porównano projekt z oryginalną lekcją `C:\Users\lbore\laba-agenci-ai-s2\lekcja_01.md`. Zachowano minimalny zakres: Next.js App Router, TypeScript, czat, jedno hasło i sesja. Bez rejestracji, OAuth, bazy danych i dodatkowych funkcji.

## Sprawdzone lokalnie

- CHAT_PASSWORD, SESSION_SECRET, OPENROUTER_API_KEY i OPENROUTER_MODEL są obecne i niepuste. Sekret sesji spełnia minimum długości. Nie ujawniono wartości i nie zmieniono ustawień OpenRouter. Obecność klucza/modelu nie potwierdza ich ważności u dostawcy.
- Ekran Wpisz hasło, Wejdź, Wyjdź; walidacja hasła tylko na serwerze; podpis HMAC, 8 godzin, HttpOnly, SameSite=Strict i Secure w produkcji.
- 401 bez sesji przed wywołaniem modelu; brak konfiguracji blokuje dostęp; zmienione i wygasłe cookie jest odrzucane.
- 9 testów (`npm.cmd test`): logowanie, wyjście, limit prób, historia, puste wiadomości, błędy dostawcy, brak konfiguracji i streaming przez rzeczywisty AI SDK z lokalnym modelem testowym. Bez połączeń do OpenRouter.
- `npm.cmd run build`: zakończony poprawnie. Build obejmuje sprawdzenie TypeScript.
- `node tests/production-smoke.cjs`: test HTTP gotowego buildu z fikcyjnym hasłem i bez klucza modelu; logowanie, cookie Secure, sesja, wylogowanie, 401 i 503. Używa lokalnego portu 3217 i zatrzymuje swój serwer.
- .env.local i .env.auth.local są ignorowane. Brak śledzonych plików .env z sekretami; znanych lokalnych sekretów nie znaleziono w bieżących plikach przeznaczonych do publikacji. Nie jest to audyt całej historii Git.
- Wersja providera 2.9.1 deklaruje zgodność z AI SDK 6 i Zod 4, zgodnie z zainstalowanym manifestem. Zachowano package-lock.json.

## Przed GitHub i Vercel

Nie wykonano commit, push ani deploy. Wysyłaj projekt wyłącznie do własnego repozytorium, nie do repo materiałów kursowych. Przed commitem sprawdź `git status --short`; dodaj kod aplikacji, testy, dokumentację, package.json, lockfile i pusty .env.example. Nigdy nie dodawaj plików .env z wartościami.

Na Vercel ustaw bezpośrednio w panelu cztery zmienne z lekcji: OPENROUTER_API_KEY, OPENROUTER_MODEL, CHAT_PASSWORD, SESSION_SECRET. Nie przesyłaj ich przez rozmowę ani zrzuty ekranu.

Obecna implementacja wymaga dodatkowo globalnego limitu POST /api/login w WAF i potwierdzenia CHAT_LOGIN_RATE_LIMIT_CONFIGURED=true. Nie ustawiaj flagi przed faktycznym skonfigurowaniem i sprawdzeniem reguły. Lokalny licznik procesu nie chroni globalnie wielu instancji. Konfiguracja reguły w panelu zależy od hostingu i planu; jeśli panel wymaga płatnej opcji, najpierw podejmij decyzję o kosztach. Nie uruchomiono żadnej płatnej usługi.

Oficjalna instrukcja WAF: https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting
Oficjalny manifest providera: https://github.com/OpenRouterTeam/ai-sdk-provider/blob/2.9.1/package.json

## Co pozostaje do potwierdzenia

W prywatnym oknie przeglądarki sprawdź wygląd, błędne i poprawne hasło, wyjście i ponowne logowanie. Test HTTP nie zastępuje sprawdzenia interfejsu w przeglądarce.

Po świadomej zgodzie na koszt wyślij do prawdziwego modelu „Mam na imię Alex”, a potem „Jak mam na imię?”. Sprawdź stopniowe pojawianie się odpowiedzi i pamiętanie imienia. Tego testu nie wykonano automatycznie.

Po późniejszym deployu powtórz logowanie i czat pod publicznym linkiem, sprawdź WAF i Secure, wyłącz lokalny serwer i sprawdź działanie linku online. Lekcja będzie w pełni ukończona dopiero po uzyskaniu własnego linku i prawdziwej odpowiedzi AI. Kod jest przygotowany do aktualizacji GitHub; publikacja wymaga konfiguracji WAF i powyższych sprawdzeń.
