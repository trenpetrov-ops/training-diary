/**
 * HTML нижней навигации (монтируется из nav/bottom-nav.js)
 */
export const bottomNavMarkup = `
    <div class="navigation-fon"></div>
    <div class="navigation">
        <button id="reports-btn" class="nav-btn" aria-label="Отчеты">
            <div id="reports-icon" class="nav-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                    <title>Report-analytics SVG Icon</title>
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6">
                        <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"></path>
                        <path d="M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2m0 12v-5m3 5v-1m3 1v-3"></path>
                    </g>
                </svg>
            </div>
            <span class="nav-label"><span>Отчеты</span></span>
        </button>
        <button id="journal-btn" class="nav-btn" aria-label="Журнал">
            <div id="journal-icon" class="nav-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="27" height="27" viewBox="0 0 24 24" aria-hidden="true">
                    <title>Calendar-clock SVG Icon</title>
                    <path fill="currentColor" fill-rule="evenodd" d="M9 2.25a.75.75 0 0 1 .75.75v1.25h4.5V3a.75.75 0 0 1 1.5 0v1.25H17A2.75 2.75 0 0 1 19.75 7v3.5a.75.75 0 0 1-.75.75H5.75V18c0 .69.56 1.25 1.25 1.25h4a.75.75 0 0 1 0 1.5H7A2.75 2.75 0 0 1 4.25 18V7A2.75 2.75 0 0 1 7 4.25h1.25V3A.75.75 0 0 1 9 2.25m5.25 3.5V7a.75.75 0 0 0 1.5 0V5.75H17c.69 0 1.25.56 1.25 1.25v2.75H5.75V7c0-.69.56-1.25 1.25-1.25h1.25V7a.75.75 0 0 0 1.5 0V5.75zm2.5 8a3 3 0 1 0 0 6a3 3 0 0 0 0-6m-4.5 3a4.5 4.5 0 1 1 9 0a4.5 4.5 0 0 1-9 0m5-1.25a.75.75 0 0 0-1.5 0v2c0 .414.336.75.75.75h1a.75.75 0 0 0 0-1.5h-.25z" clip-rule="evenodd"></path>
                </svg>
            </div>
            <span class="nav-label"><span>Журнал</span></span>
        </button>
        <button id="programs-btn" class="nav-btn" aria-label="Тренировки">
            <div id="programs-icon" class="nav-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <title>Travel-hotel-dumbell-sports-weights-dumbbell-sport-fitness SVG Icon</title>
                    <g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="0.95">
                        <rect width="4" height="6" x=".5" y="4" rx="1"></rect>
                        <rect width="4" height="6" x="9.5" y="4" rx="1"></rect>
                        <path d="M4.5 7h5"></path>
                    </g>
                </svg>
            </div>
            <span class="nav-label"><span>Тренировки</span></span>
        </button>
        <button id="meal-btn" class="nav-btn" aria-label="Питание">
            <div id="meal-icon" class="nav-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                    <title>Food-apple-24-regular SVG Icon</title>
                    <path fill="currentColor" d="M8.397 11.235a.75.75 0 0 0-.294-1.471c-.903.18-1.585.812-1.948 1.659c-.36.838-.413 1.886-.132 3.008a.75.75 0 1 0 1.455-.363c-.22-.878-.148-1.58.055-2.054c.2-.466.518-.71.864-.78M5.471 3.419A5.18 5.18 0 0 0 6.89 7.302a5.12 5.12 0 0 0-3.66 4.216a10.46 10.46 0 0 0 1.37 6.796l.35.59l.043.063l1.416 1.906a3.462 3.462 0 0 0 5.275.336a.437.437 0 0 1 .63 0a3.462 3.462 0 0 0 5.275-.336l1.416-1.907l.042-.063l.351-.59a10.46 10.46 0 0 0 1.373-6.795a5.12 5.12 0 0 0-6.11-4.306l-1.901.394h-.003c.03-.78.152-1.62.391-2.338c.29-.868.692-1.39 1.14-1.576a.75.75 0 1 0-.578-1.385c-1.052.439-1.65 1.48-1.985 2.486l-.046.142a5.2 5.2 0 0 0-.943-1.29a5.18 5.18 0 0 0-3.98-1.51A1.367 1.367 0 0 0 5.47 3.418m1.493.207a3.68 3.68 0 0 1 2.712 1.08a3.68 3.68 0 0 1 1.08 2.712a4 4 0 0 1-.543-.025l-.617-.128a3.7 3.7 0 0 1-1.552-.927a3.68 3.68 0 0 1-1.08-2.712m2.07 5.055l.202.042q.36.102.73.152l.97.2a5.25 5.25 0 0 0 2.13 0l1.902-.394a3.62 3.62 0 0 1 4.32 3.045a8.96 8.96 0 0 1-1.177 5.821l-.331.557l-1.393 1.876a1.962 1.962 0 0 1-2.99.19a1.936 1.936 0 0 0-2.792 0a1.962 1.962 0 0 1-2.99-.19l-1.393-1.876l-.331-.557a8.96 8.96 0 0 1-1.176-5.821A3.62 3.62 0 0 1 9.033 8.68"></path>
                </svg>
            </div>
            <span class="nav-label"><span>Питание</span></span>
        </button>
        <button id="supplements-btn" class="nav-btn" aria-label="Бады">
            <div id="supplement-icon" class="nav-icon">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
                    <title>Capsules SVG Icon</title>
                    <path fill="currentColor" d="M8.5 5A5.506 5.506 0 0 0 3 10.5v11C3 24.532 5.467 27 8.5 27s5.5-2.468 5.5-5.5v-5.096l6.055 8.332a5.5 5.5 0 0 0 4.457 2.268a5.48 5.48 0 0 0 3.226-1.049v-.002a5.506 5.506 0 0 0 1.215-7.682l-6.465-8.9a5.504 5.504 0 0 0-7.681-1.215a5.5 5.5 0 0 0-.995.942C13.19 6.744 11.049 5 8.5 5m0 2c1.93 0 3.5 1.57 3.5 3.5V15H5v-4.5C5 8.57 6.57 7 8.5 7m9.535 2.105a3.5 3.5 0 0 1 2.836 1.442l2.645 3.639l-5.662 4.117l-2.647-3.64a3.504 3.504 0 0 1 .775-4.89c.62-.45 1.34-.668 2.053-.668m6.656 6.698l2.647 3.642a3.507 3.507 0 0 1-.776 4.89a3.503 3.503 0 0 1-4.888-.774l-2.645-3.641zM5 17h7v4.5c0 1.93-1.57 3.5-3.5 3.5S5 23.43 5 21.5z"></path>
                </svg>
            </div>
            <span class="nav-label"><span>Бады</span></span>
        </button>
    </div>
`;
