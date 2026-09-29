// ECPay C2C 寄件資料
// 這裡不是 Vercel Environment Variable；請填入你實際的出貨資訊。
// ECPay 官方要求 SenderName / SenderZipCode / SenderAddress 必填。
export const ECPAY_LOGISTICS_CONFIG = {
  senderName: "赫菲斯微景",
  senderZipCode: "請填寄件郵遞區號",
  senderAddress: "請填實際寄件地址",

  // C2C 常溫、60cm。
  temperature: "0001",
  specification: "0001",

  // 這裡先用固定超商運費，避免前端自行相信使用者傳入的金額。
  // 之後若你要依物流子類型分別定價，只改這裡即可。
  shippingFees: {
    UNIMARTC2C: 60,
    FAMIC2C: 60,
    HILIFEC2C: 60
  }
};
