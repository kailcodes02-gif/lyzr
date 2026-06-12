export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Free / personal / disposable email providers — not allowed (work emails only). */
export const FREE_EMAIL_DOMAINS = new Set<string>([
  // Google
  "gmail.com", "googlemail.com",
  // Microsoft
  "outlook.com", "outlook.in", "hotmail.com", "hotmail.co.uk", "live.com", "live.co.uk", "msn.com",
  // Yahoo
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "yahoo.in", "yahoo.fr", "ymail.com", "rocketmail.com",
  // Apple
  "icloud.com", "me.com", "mac.com",
  // AOL / others
  "aol.com",
  // Proton
  "proton.me", "protonmail.com", "pm.me",
  // GMX / Mail.com
  "gmx.com", "gmx.net", "gmx.de", "mail.com", "email.com",
  // Zoho (commonly free)
  "zoho.com", "zohomail.com",
  // Yandex
  "yandex.com", "yandex.ru",
  // China
  "qq.com", "163.com", "126.com", "sina.com", "foxmail.com",
  // Korea
  "naver.com", "daum.net",
  // Misc consumer
  "hey.com", "fastmail.com", "fastmail.fm", "tutanota.com", "tuta.io",
  // Russia
  "mail.ru", "bk.ru", "inbox.ru", "list.ru",
  // Germany / Europe ISPs
  "web.de", "t-online.de", "freenet.de", "orange.fr", "laposte.net", "libero.it", "virgilio.it", "sky.com",
  // US ISPs
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "cox.net", "bellsouth.net", "charter.net",
  "earthlink.net", "btinternet.com",
  // Disposable / temp
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "temp-mail.org",
  "trashmail.com", "yopmail.com", "getnada.com", "sharklasers.com", "dispostable.com",
]);

export function emailDomain(email: string): string {
  return email.toLowerCase().trim().split("@")[1] ?? "";
}

export function isFreeEmail(email: string): boolean {
  return FREE_EMAIL_DOMAINS.has(emailDomain(email));
}

/** Valid format AND not a free/personal provider. */
export function isWorkEmail(email: string): boolean {
  const e = email.trim();
  return EMAIL_RE.test(e) && !FREE_EMAIL_DOMAINS.has(emailDomain(e));
}
