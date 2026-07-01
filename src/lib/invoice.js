import crypto from 'node:crypto';
import { getSetting } from './settings.js';

function aesEncrypt(jsonStr, hashKey, hashIv) {
  const cipher = crypto.createCipheriv('aes-128-cbc', hashKey, hashIv);
  const urlEncoded = encodeURIComponent(jsonStr)
    .replace(/!/g, '%21').replace(/\*/g, '%2A').replace(/\(/g, '%28').replace(/\)/g, '%29');
  let enc = cipher.update(urlEncoded, 'utf8', 'base64');
  enc += cipher.final('base64');
  return enc;
}

function aesDecrypt(b64, hashKey, hashIv) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', hashKey, hashIv);
  let dec = decipher.update(b64, 'base64', 'utf8');
  dec += decipher.final('utf8');
  return decodeURIComponent(dec);
}

export async function issueInvoice({
  merchantTradeNo,
  totalAmount,
  itemNames,
  itemPrices,
  itemCounts,
  customerEmail,
  customerName,
  customerIdentifier,
}) {
  const merchantId = await getSetting('ECPAY_INVOICE_MERCHANT_ID');
  const hashKey    = await getSetting('ECPAY_INVOICE_HASH_KEY');
  const hashIv     = await getSetting('ECPAY_INVOICE_HASH_IV');
  const url        = await getSetting('ECPAY_INVOICE_URL');

  const itemAmounts = itemPrices.map((p, i) => p * itemCounts[i]);

  const data = {
    MerchantID: merchantId,
    RelateNumber: merchantTradeNo,
    CustomerIdentifier: customerIdentifier ?? '',
    CustomerName: customerName ?? '',
    CustomerEmail: customerEmail ?? '',
    Print: customerIdentifier ? '1' : '0',
    Donation: '0',
    TaxType: '1',
    SalesAmount: totalAmount,
    InvType: '07',
    ItemName: itemNames.join('|'),
    ItemCount: itemCounts.join('|'),
    ItemWord: itemCounts.map(() => '個').join('|'),
    ItemPrice: itemPrices.join('|'),
    ItemAmount: itemAmounts.join('|'),
    ItemTaxType: itemCounts.map(() => '1').join('|'),
    CarrierType: '',
    CarrierNum: '',
  };

  const dataStr = JSON.stringify(data);
  const encrypted = aesEncrypt(dataStr, hashKey, hashIv);

  const envelope = {
    PlatformID: '',
    MerchantID: merchantId,
    RqHeader: { Timestamp: Math.floor(Date.now() / 1000) },
    Data: encrypted,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });

  const json = await res.json();
  if (!json.Data) throw new Error(`E-Invoice API error: ${JSON.stringify(json)}`);
  const decoded = aesDecrypt(json.Data, hashKey, hashIv);
  return JSON.parse(decoded);
}
