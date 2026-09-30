// Hephaestus Scapes - ECPay C2C 物流設定
//
// 物流的 MerchantID / HashKey / HashIV 不寫在 GitHub。
// 請在 Vercel Environment Variables 設定：
//
// ECPAY_LOGISTICS_MERCHANT_ID
// ECPAY_LOGISTICS_HASH_KEY
// ECPAY_LOGISTICS_HASH_IV
//
// 目前你申請到的物流 MerchantID 是 3514353，請把它填入 Vercel。
// HashKey / HashIV 也請填入 Vercel，不要貼進 GitHub。

export const ECPAY_LOGISTICS_CONFIG = {
  senderName: "赫菲斯微景",
  senderZipCode: "234",
  senderAddress: "新北市永和區竹林路97號5樓",

  temperature: "0001",
  specification: "0001",

  shippingFees: {
    UNIMARTC2C: 60,
    FAMIC2C: 60,
    HILIFEC2C: 60
  }
};
