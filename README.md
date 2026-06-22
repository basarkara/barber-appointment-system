# Berber Randevu Sistemi

Basit bir berber randevu sistemi. Kullanıcılar isim, soyisim, saat ve işlem seçip randevu oluşturabilir. Yönetici paneli üzerinden tüm randevular görüntülenebilir.

## Özellikler

- Randevu formu
- SQLite veritabanı ile randevu kaydı
- Admin paneli
- Mobil uyumlu tasarım

## Kurulum

1. Proje dizinine gidin:

```powershell
cd C:\Users\user\barber-appointment-system
```

2. Bağımlılıkları kurun:

```powershell
npm install
```

3. Sunucuyu başlatın:

```powershell
npm start
```

4. Tarayıcıda ziyaret edin:

- Kullanıcı: `http://localhost:3000`
- Admin: `http://localhost:3000/admin.html`

## Giriş Bilgileri

- Kullanıcı adı: `admin`
- Şifre: `1234`

> Not: Prod/demo için sabit kullanıcı bilgileri yerine ortam değişkenleri kullanılmalı. Aşağıdaki `.env.example` dosyasına göz atın.

## WhatsApp Bildirimi

Bu projeye randevu oluşturulduğunda berber ustasına WhatsApp mesajı göndermek için Twilio kullanılabilir. Aşağıdaki ortam değişkenlerini ayarlayın:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `WHATSAPP_FROM` (Twilio’nun sağladığı WhatsApp numarası, örn. `whatsapp:+14155238886` değil, sadece `+14155238886`)
- `WHATSAPP_TO` (Mesaj gönderilecek numara, örn. `+90XXXXXXXXXX`)

Eğer bu değişkenler ayarlı değilse, proje normal şekilde çalışır ancak WhatsApp bildirimi gönderilmez.

## Hızlı Demo (başkalarıyla paylaşmak için)

- Localtunnel (kolay):

```powershell
npx localtunnel --port 3000
# çıktıdaki URL'i paylaşın
```

- ngrok (daha güvenilir):

1. https://ngrok.com adresinden kayıt olun ve token alın.
2. `ngrok authtoken <TOKEN>`
3. `ngrok http 3000` komutu size HTTPS URL verecektir.

## Git / Push adımları

1. Yeni bir GitHub repo oluşturun (ör. `youruser/barber-appointment-system`).
2. Lokal repo içinden remote ekleyin ve pushlayın:

```powershell
git init
git add .
git commit -m "Prepare project for demo: env, gitignore, per-service buffers"
git remote add origin https://github.com/youruser/your-repo.git
git branch -M main
git push -u origin main
```

Not: `.gitignore` içinde `appointments.db` ve `.env` bulunuyor — bu yüzden yerel SQLite veritabanı veya gizli anahtarlar Git'e gitmeyecektir.

## Değiştirilebilir Alanlar

- Yönetici kullanıcı adı ve şifreyi `server.js` içinde değiştirebilirsiniz.
- İşlem seçeneklerini `public/index.html` içinde düzenleyebilirsiniz.

## Not

- `appointments.db` dosyası otomatik olarak oluşturulur.
- Geliştirme aşamasında portu `PORT` ortam değişkeni ile değiştirebilirsiniz.
