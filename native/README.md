# Music24 Native Shell

מעטפת Capacitor דקה סביב `https://music24.apbs.link` עם Media Session מקומי:
התראת Now Playing, כפתורי ניגון, לייק, ו־foreground service לניגון ברקע.

## בניית APK

1. התקינו Android Studio + SDK API 34 + JDK 17
2. בפרויקט:
   ```powershell
   cd L:\LlamaStream\native
   npm install
   npx cap sync android
   npx cap open android
   ```
3. ב־Android Studio: **Build → Build APK(s)**
4. קובץ: `android\app\build\outputs\apk\debug\app-debug.apk`

## חשוב

- צריך **גם** לפרוס את ה־frontend המעודכן ל־`music24.apbs.link` — האפליקציה טוענת את האתר מרחוק.
- בפעם הראשונה אנדרואיד יבקש אישור להתראות — אשרו כדי לראות את כרטיס הניגון.
- כפתור Back שולח לרקע (לא סוגר). סגירה מ־Recent Tasks עדיין עלולה לעצור WebView.
- פייד מלא עם מסך נעול עדיין מוגבל; מעבר שירים + התראה אמורים לעבוד.
