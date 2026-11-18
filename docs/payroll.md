# Hiệu suất và bảng lương

- Kỳ lương là tháng dương lịch theo `Asia/Ho_Chi_Minh`. Chỉ lập bảng lương sau khi tháng kết thúc.
- Center Manager cấu hình lương cơ bản và khoản phụ cấp/khấu trừ định kỳ theo tháng hiệu lực, sau đó tạo bảng lương nháp, đối soát và duyệt.
- Trừ vắng = lương cơ bản × số ca/buổi vắng ÷ số ca/buổi được xếp trong tháng, làm tròn đến đồng. Không được xếp ca/buổi thì không trừ lương cơ bản.
- Lễ tân thiếu giờ vào hoặc giờ ra của ca đã kết thúc được tính là vắng. Yêu cầu chỉnh chấm công đang chờ duyệt chặn duyệt kỳ lương.
- Buổi nhóm chưa hoàn tất điểm danh và buổi 1–1 chưa được hội viên xác nhận chặn duyệt kỳ lương.
- Buổi bù hoàn thành và đã xác nhận được cộng lại khoản trừ vắng. `PayrollMakeupCredit` có khóa duy nhất theo yêu cầu báo nghỉ để tránh cộng hai lần, kể cả bù ở tháng sau.
- Bảng lương `APPROVED` là bản chốt. Không được tính lại hoặc sửa phiếu; điều chỉnh cấu hình về sau không thay đổi kỳ đã duyệt.
- Coach/lễ tân chỉ xem hiệu suất và phiếu lương đã duyệt của chính mình. Hệ thống không tự tính thuế/bảo hiểm và không chuyển tiền.

API chính: `GET /api/staff/performance`, `GET /api/payroll/me/performance`, `GET /api/payroll/me/payslips`, `GET /api/payroll/periods/:month`, `POST /api/payroll/periods/:month/build`, `POST /api/payroll/periods/:month/approve`, `GET /api/payroll/periods/:month/export`. Xem Swagger để biết các API cấu hình lương và tải PDF.

## Kỳ lịch sử 05–10/2026

- Đã lập các kỳ 05–10/2026 từ dữ liệu công việc có sẵn. Không tạo ca, buổi học hoặc điểm danh giả. Kỳ 08/2026 đã được Center Manager duyệt trong hệ thống và được giữ nguyên; các kỳ còn lại là bản nháp.
- Người phụ trách dự án đã xác nhận mức lương cơ bản hiệu lực 05–10/2026: Lễ tân Sportigo 8.000.000đ/tháng; 7 Coach nhận việc trước kỳ 9.000.000đ/người/tháng. Việc xác nhận mức lương không thay thế bước đối soát chấm công và duyệt từng kỳ.
- Dữ liệu hiện chưa có ca làm lễ tân; tháng 10 còn ba buổi nhóm chưa hoàn tất điểm danh. Giá trị nháp không chứng minh số tiền thực tế phải trả.
- Theo yêu cầu demo, các bản nháp 05, 06, 07, 09 và 10/2026 có 7 dòng điều chỉnh vắng/bù ca **minh họa** trong `PayrollEntry`; từng dòng có `workEvidence.demoPayrollScenario` và `reviewIssues` chứa `DỮ LIỆU DEMO`, vì thế không thể duyệt. Đây không phải bản ghi chấm công, nghỉ dạy hay buổi bù thật. Kỳ 08/2026 đã duyệt không thay đổi. Chạy `npx tsx scripts/demo-payroll-history.ts --apply` chỉ một lần sau khi lập kỳ nháp; script tạo bản sao lưu trước khi ghi. Tính lại kỳ nháp từ dữ liệu nguồn sẽ xóa các tình huống demo.
- Bản sao dữ liệu lương trước khi bổ sung nằm ngoài repository tại `C:\SWP391_FA26\backups\pre-historical-payroll-20261119.json`.
