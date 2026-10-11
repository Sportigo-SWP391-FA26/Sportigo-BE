# Cấu trúc backend

```text
src/
├─ config/          # Đọc và kiểm tra biến môi trường
├─ lib/             # Hạ tầng dùng chung: Prisma, lỗi HTTP
├─ middleware/      # Express middleware dùng toàn hệ thống
├─ modules/         # Nghiệp vụ, chia theo từng bounded feature
│  └─ auth/
│     ├─ *.routes.ts       # Khai báo endpoint
│     ├─ *.controller.ts   # Nhận request và trả response
│     ├─ *.schema.ts       # Validate input bằng Zod
│     ├─ *.service.ts      # Luật nghiệp vụ
│     └─ *.repository.ts   # Truy cập dữ liệu
├─ routes/          # Ghép router của các module
├─ app.ts           # Cấu hình Express, không mở cổng
└─ server.ts        # Điểm khởi chạy và mở cổng
```

## Quy tắc phụ thuộc

- `routes → controller → service → repository → Prisma`.
- Controller không viết truy vấn cơ sở dữ liệu hoặc luật nghiệp vụ.
- Service không phụ thuộc đối tượng `Request`/`Response` của Express.
- Schema Prisma là nguồn sự thật của mô hình dữ liệu; API input được kiểm tra riêng bằng Zod.
- Một module nghiệp vụ mới nằm trọn trong `src/modules/<feature>` và chỉ được đưa ra ngoài thông qua router/public export cần thiết.
- Không tạo `utils` chung chung. Chỉ chuyển mã vào phần dùng chung khi có ít nhất hai nơi thực sự sử dụng.
