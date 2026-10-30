# Konfiguracja czatu

W istniejącym `.env.local` dopisz w edytorze `CHAT_PASSWORD=` i po znaku `=` ustaw własne silne hasło. Zachowaj konfigurację OpenRouter. Usuń nieużywany CHAT_ACCESS_CODE, jeśli występuje. Nie stosuj prefiksu NEXT_PUBLIC_.

Wygenerowany kryptograficznie SESSION_SECRET jest zapisany w ignorowanym pliku `.env.auth.local`. Next.js nie ładuje go automatycznie: w edytorze przenieś ten wpis do `.env.local`, bez wklejania wartości do terminalu, rozmowy ani repozytorium. Jeśli masz już SESSION_SECRET, zachowaj istniejący wpis zamiast dodawać drugi. Zrestartuj serwer. Istniejącego `.env.local` nie odczytywano ani nie zmieniano automatycznie.

.gitignore wyklucza `.env*`, z wyjątkiem pustego szablonu `.env.example`.

Sesja trwa 8 godzin, podpis HMAC-SHA256. Cookie: HttpOnly, SameSite=Strict, Path=/, Secure w produkcji. Hasło nie trafia do cookie. Wyjście usuwa cookie i bieżącą rozmowę. Bez magazynu sesji skopiowane wcześniej cookie pozostaje ważne do wygaśnięcia. Zmiana SESSION_SECRET unieważnia wszystkie sesje.

## Hosting: wymagany globalny limit

W zaporze hostingu (WAF) ustaw limit POST `/api/login`, np. 5 prób/minutę na adres klienta oraz dodatkowy limit łączny dla tej ścieżki, np. 50 prób/minutę. Reguła musi działać przed aplikacją, obejmować wszystkie instancje, domeny i adresy podglądowe. Zablokuj możliwość ominięcia zapory przez bezpośredni adres serwera. Sprawdź blokadę również przy żądaniach do różnych instancji. Ustaw limit rozmiaru żądania, np. 4 KB. Dobierz wartości do potrzeb i platformy.

Dopiero po włączeniu i sprawdzeniu reguły ustaw na hostingu `CHAT_LOGIN_RATE_LIMIT_CONFIGURED=true`, CHAT_PASSWORD i SESSION_SECRET. Flaga to potwierdzenie administratora, nie implementacja ani automatyczna weryfikacja WAF. Bez niej produkcja blokuje dostęp. Jeśli hosting nie oferuje globalnego limitowania, nie włączaj flagi; potrzebna jest zapora przed hostingiem. Nie dodano bazy danych. Lokalny licznik 5 prób/minutę to tylko dodatkowy limit procesu, resetowany po restarcie.

## Weryfikacja

`node --test tests/chat-access.test.cjs`: bez ładowania .env i z atrapą OpenRouter. Testy obejmują poprawne i błędne hasło, cookie, walidację rozmowy i atrapę streamingu, zmienioną/wygasłą sesję, wyjście, 401 bez sesji, brak konfiguracji, Secure w produkcji, limit prób i obcy Origin. `npx tsc --noEmit` sprawdza typy bez ładowania sekretów.

Ręcznie: po konfiguracji sprawdź ekran „Wpisz hasło”, oba wyniki logowania, odświeżenie z zachowaniem sesji, „Wyjdź” i ponowną odmowę dostępu. W przeglądarce sprawdź atrybuty cookie i brak hasła w cookie. Na hostingu sprawdź HTTPS/Secure oraz globalny limit WAF. Rzeczywisty streaming i nawiązanie do historii wymagają wysłania wiadomości do OpenRouter (może być płatne); testy tego nie robią. Historia pozostaje w bieżącej rozmowie; odświeżenie usuwa ją, jak wcześniej.
