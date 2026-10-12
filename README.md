# SportCenter_BE

Backend API cho Sports Center Management System.

## Chạy local

1. Sao chép `.env.example` thành `.env`.
2. Chạy PostgreSQL: `docker compose up -d`.
3. Cài dependency: `npm install`.
4. Sinh Prisma Client: `npm run db:generate`.
5. Tạo migration: `npm run db:migrate -- --name init`.
6. Seed dữ liệu: `npm run db:seed`.
7. Chạy API: `npm run dev`.

Health check: `GET http://localhost:3000/health`.

Swagger UI: `http://localhost:3000/api-docs`.

## Gửi email xác minh

Backend gọi một Google Apps Script qua HTTPS để tương thích với Render Free
(Render chặn các cổng SMTP). Apps Script gửi mail bằng Gmail của Sportigo và xác
thực request bằng secret. Cấu hình `GMAIL_WEBHOOK_URL`, `GMAIL_WEBHOOK_SECRET`
và `EMAIL_FROM` theo `.env.example`; không commit URL/secret triển khai vào Git.

Xem [ARCHITECTURE.md](./ARCHITECTURE.md) để biết cấu trúc thư mục và quy tắc phụ thuộc.
