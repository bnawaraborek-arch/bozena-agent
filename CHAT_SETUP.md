# Konfiguracja czatu

Utwórz .env.local w katalogu głównym projektu i wpisz samodzielnie w edytorze:

    OPENROUTER_API_KEY=
    OPENROUTER_MODEL=

Po znaku = w pierwszym wierszu wpisz swój klucz OpenRouter, a w drugim pełny identyfikator modelu z OpenRouter. Nie używaj prefiksu NEXT_PUBLIC_. Pliki .env i .env.local są ignorowane przez Git. .env.example zawiera wyłącznie puste pola.

Uruchom npm install, następnie npm run dev. Po zmianie konfiguracji zrestartuj serwer. Otwórz adres podany przez Next.js i wyślij pierwszą wiadomość. Sprawdź stopniowe pojawianie się odpowiedzi i zadaj pytanie nawiązujące do poprzedniej wiadomości.

Klucz jest używany wyłącznie przez serwerowy /api/chat. Historia bieżącej rozmowy jest przesyłana przy każdym żądaniu. Odświeżenie strony ją usuwa. Brak konfiguracji wyświetla błąd.

Wybrano AI SDK 6, @ai-sdk/react 3 i OpenRouter provider 2.9.1. Oficjalny manifest providera potwierdza zgodność z ai@^6.0.0 i Zod 4:
https://github.com/OpenRouterTeam/ai-sdk-provider/blob/2.9.1/package.json

W środowisku wykonania zmian dostęp do registry.npmjs.org był zablokowany (EACCES), a pakietów nie było w cache. Zachowano istniejący package-lock.json. Jego aktualizacja i sprawdzenie kompilacji wymagają npm install z dostępem do rejestru. Nie wykonano wywołań do OpenRouter.
