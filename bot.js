require('dotenv').config();
const config = require('./config');
process.env.TZ = config.timezone;
const mongoose = require('mongoose');

const mongoConnection = mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 10000
});

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true, index: true },
  username: { type: String, default: '' },
  referredBy: { type: Number, default: null },
  joinedAt: { type: Date, default: Date.now },
  personalId: { type: Number },
  nickname: { type: String, default: '' },
  language: { type: String, default: null },
  channels: { type: Array, default: [] },
  premium: { type: Boolean, default: false },
  postLog: { type: Array, default: [] },
  templates: { type: Array, default: [] },
  publishedPosts: { type: Number, default: 0 },
  publishedChannels: { type: Number, default: 0 },
  lastPublishedAt: { type: Date, default: null },
  postStats: { type: Array, default: [] },
  profileSeen: { type: Boolean, default: false },
}, { versionKey: false });

const botConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'main_config', unique: true },
  channels: { type: Array, default: [] },
  maintenanceMode: { type: Boolean, default: false },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} },
  stats: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { versionKey: false });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const BotConfig = mongoose.models.BotConfig || mongoose.model('BotConfig', botConfigSchema);

const express = require('express');
const app = express();
const port = Number(process.env.PORT) || 3000;

app.get('/', (req, res) => res.send('Bot ishlamoqda...'));
app.get('/health', (req, res) => res.status(200).json({
  ok: true,
  mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
}));

app.listen(port, '0.0.0.0', () => {
  console.log(`Express server ${port} portda ishlayapti.`);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Telegraf, Markup, session } = require('telegraf');

const token = config.botToken;
if (!token) {
  throw new Error('BOT_TOKEN is missing. Copy .env.example to .env and add the token.');
}

const bot = new Telegraf(token);
const BOT_TIMEZONE = config.timezone;
const PREMIUM_EMOJI_TAG = '<tg-emoji emoji-id="5084974483685507801">💜</tg-emoji>';
const CANCEL_EMOJI_TAG = '<tg-emoji emoji-id="5199785165735367039">⚡️</tg-emoji>';

async function safeAnswerCbQuery(ctx) {
  if (!ctx.callbackQuery) return;
  try {
    await ctx.answerCbQuery();
  } catch (error) {
    console.warn('Callback answer failed:', error.response?.description || error.message);
  }
}

bot.use(async (ctx, next) => {
  try {
    return await next();
  } catch (error) {
    console.error(`Update ${ctx.updateType} failed:`, error.response?.description || error.message);
    await safeAnswerCbQuery(ctx);
    if (ctx?.reply) {
      await ctx.reply('Texnik xatolik yuz berdi. Qaytadan urinib ko\'ring.').catch(() => {});
    }
  }
});

function prefixPremiumEmojiIfMissing(text) {
  if (typeof text !== 'string') return text;
  if (/<tg-emoji\s+emoji-id=\"[^"]+\">[\s\S]*?<\/tg-emoji>/.test(text)) return text;
  return `${PREMIUM_EMOJI_TAG} ${text}`;
}

const originalSendMessage = bot.telegram.sendMessage.bind(bot.telegram);
bot.telegram.sendMessage = async (chatId, text, extra = {}) => {
  const enrichedText = prefixPremiumEmojiIfMissing(text);
  const enrichedExtra = { ...extra };
  if (enrichedExtra.parse_mode === undefined && enrichedText.includes('<tg-emoji')) {
    enrichedExtra.parse_mode = 'HTML';
  }
  return originalSendMessage(chatId, enrichedText, enrichedExtra);
};

const originalSendPhoto = bot.telegram.sendPhoto.bind(bot.telegram);
bot.telegram.sendPhoto = async (chatId, photo, extra = {}) => {
  const enrichedExtra = { ...extra };
  if (typeof enrichedExtra.caption === 'string') {
    enrichedExtra.caption = prefixPremiumEmojiIfMissing(enrichedExtra.caption);
  }
  if (enrichedExtra.parse_mode === undefined && typeof enrichedExtra.caption === 'string' && enrichedExtra.caption.includes('<tg-emoji')) {
    enrichedExtra.parse_mode = 'HTML';
  }
  return originalSendPhoto(chatId, photo, enrichedExtra);
};

const localDataPath = path.join(__dirname, 'data.json');
const renderDiskDataPath = '/opt/render/project/src/data/data.json';
const legacyDataPath = fs.existsSync(renderDiskDataPath) ? renderDiskDataPath : localDataPath;
const legacyData = fs.existsSync(legacyDataPath) ? JSON.parse(fs.readFileSync(legacyDataPath, 'utf8')) : { users: {} };
const data = { users: {}, settings: {}, stats: {} };
data.users ||= {};
data.settings ||= {};
data.settings.requiredChannels ||= [];
data.settings.premiumCardNumber ||= '9860 0803 9258 5933';
data.settings.premiumPrice ||= 10000;
if (data.settings.requiredChannel && !Array.isArray(data.settings.requiredChannels)) {
  data.settings.requiredChannels = [data.settings.requiredChannel];
}
if (data.settings.requiredChannel && Array.isArray(data.settings.requiredChannels)) {
  data.settings.requiredChannels.unshift(data.settings.requiredChannel);
  delete data.settings.requiredChannel;
}
if (!Array.isArray(data.settings.requiredChannels)) data.settings.requiredChannels = [];
const { username: ADMIN_USERNAME, publicUsername: ADMIN_PUBLIC_USERNAME, telegramId: ADMIN_TG_ID } = config.admin;
const languages = {
  uz: 'O\'zbekcha', en: 'English', ru: 'Русский'
};
const text = {
  welcome: { uz: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> Tilni tanlang:', en: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> Choose your language:', ru: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> Выберите язык:', ar: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> اختر لغتك:', tr: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> Dilinizi seçin:', zh: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> 请选择语言：', ko: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> 언어를 선택하세요:', tg: '<tg-emoji emoji-id="5463392464314315076">👉</tg-emoji> Забонро интихоб кунед:' },
  channels: { uz: '📢 Kanallar ro\'yxati', en: '📢 Channel list', ru: '📢 Список каналов', ar: '📢 قائمة القنوات', tr: '📢 Kanal listesi', zh: '📢 频道列表', ko: '📢 채널 목록', tg: '📢 Рӯйхати каналҳо' },
  addChannel: { uz: '➕ Kanal qo\'shish', en: '➕ Add channel', ru: '➕ Добавить канал', ar: '➕ إضافة قناة', tr: '➕ Kanal ekle', zh: '➕ 添加频道', ko: '➕ 채널 추가', tg: '➕ Иловаи kanal' },
  settings: { uz: 'Sozlamalar', en: 'Settings', ru: 'Настройки', ar: 'الإعدادات', tr: 'Ayarlar', zh: '设置', ko: '설정', tg: 'Танзимот' },
  admin: { uz: '🛠 Admin panel', en: '🛠 Admin panel', ru: '🛠 Панель администратора', ar: '🛠 لوحة المشرف', tr: '🛠 Yönetici paneli', zh: '🛠 管理员面板', ko: '🛠 관리자 패널', tg: '🛠 Панели админ' },
  languageSaved: { uz: '✅ Til saqlandi.', en: '✅ Language saved.', ru: '✅ Язык сохранён.', ar: '✅ تم حفظ اللغة.', tr: '✅ Dil kaydedildi.', zh: '✅ 语言已保存。', ko: '✅ 언어가 저장되었습니다.', tg: '✅ Забон нигоҳ дошта шуд.' },
  createPost: { uz: '📨 Post yuborish', en: '📨 Create Post', ru: '📨 Создать пост', ar: '📨 إنشاء منشور', tr: '📨 Gönderi oluştur', zh: '📨 创建帖子', ko: '📨 게시물 만들기', tg: '📨 Эҷоди пост' },
  videoSave: { uz: '🎬 Video saqlash', en: '🎬 Save video', ru: '🎬 Сохранить видео', ar: '🎬 حفظ فيديو', tr: '🎬 Video kaydet', zh: '🎬 保存视频', ko: '🎬 영상 저장', tg: '🎬 Сабти видео' },
  profile: { uz: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> Profilim', en: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> My Profile', ru: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> Мой профиль', ar: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> صفحتي', tr: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> Profilim', zh: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> 我的资料', ko: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> 내 프로필', tg: '<tg-emoji emoji-id="5461117441612462242">🙂</tg-emoji> Профили ман' },
  botId: { uz: 'Botdagi ID', en: 'Bot ID', ru: 'ID бота', ar: 'معرف البوت', tr: 'Bot ID', zh: '机器人 ID', ko: '봇 ID', tg: 'ID-и бот' },
  telegramId: { uz: 'Telegram ID', en: 'Telegram ID', ru: 'Telegram ID', ar: 'معرف تلغрам', tr: 'Telegram ID', zh: 'Telegram ID', ko: '텔레그램 ID', tg: 'ID-и Телеграм' },
  username: { uz: 'Username', en: 'Username', ru: 'Username', ar: 'اسم المستخدم', tr: 'Kullanıcı adı', zh: '用户名', ko: '사용자 이름', tg: 'Номи корбар' },
  nickname: { uz: 'Nickname', en: 'Nickname', ru: 'Nickname', ar: 'اسم المستعار', tr: 'Takma ad', zh: '昵称', ko: '닉네임', tg: 'Никнейм' },
};
const replyTranslations = {
  en: {
    'Ruxsat yo\'q.': 'Access denied.', 'Kanal topilmadi.': 'Channel not found.', 'Post uchun rasm yuboring.': 'Send a photo for the post.',
    'Tugma matnini yuboring:': 'Send the button text:', 'Tugma rangini tanlang:': 'Choose the button color:',
    'Amal bekor qilindi.': 'Action cancelled.', 'Kanalni tanlang:': 'Choose a channel:',
    'Kanal username sini yuboring, masalan: @my_channel': 'Send the channel username, for example: @my_channel',
    'Izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:': 'Caption saved. You can add URL buttons:',
    'Post tayyor. Havolali tugmalar qo\'shishingiz mumkin:': 'Post ready. You can add URL buttons:',
    'Tugma rangini tanlang:': 'Choose the button color:',
    'Havola http:// yoki https:// bilan boshlanishi kerak. Qayta yuboring:': 'The URL must start with http:// or https://. Send it again:',
    'Kerakli amalni pastki menyudan tanlang.': 'Choose an action from the menu.',
    'Broadcast boshlanmagan.': 'Broadcast has not started.', 'Broadcast izohini yuboring:': 'Send the broadcast caption:',
    'Rasm saqlandi. Broadcast izohini yuboring:': 'Photo saved. Send the broadcast caption:',
    'Post ma\'lumotlari topilmadi.': 'Post data was not found.', 'Broadcast mazmuni topilmadi.': 'Broadcast content was not found.',
    'Texnik xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.': 'A technical error occurred. Try again later.',
    'Assalomu alaykum! Kanal postlarini boshqarish botiga xush kelibsiz.': 'Welcome to the channel post management bot.',
    'Rasm va izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:': 'Photo and caption saved. You can add URL buttons:',
    'Endi post izohini yuboring yoki «Izohsiz» tugmasini bosing.': 'Send the post caption or press “No caption”.',
    'Avval post yaratishni boshlang.': 'Start creating a post first.', 'Tugma ma\'lumotlari topilmadi. Qaytadan boshlang.': 'Button data was not found. Start again.',
    'Rangli tugma qo\'shildi. Yana tugma qo\'shasizmi yoki postni yuboramizmi?': 'Colored button added. Add another button or publish the post?',
    'Majburiy obuna kanalining public username sini yuboring, masalan: @my_channel': 'Send the required subscription channel username, for example: @my_channel',
    'Broadcast uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Send a broadcast photo or press “Without photo”.',
    'Tugma havolasini yuboring (https://...):': 'Send the button URL (https://...):', 'Rasm va izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:': 'Photo and caption saved. You can add URL buttons:',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Send a photo for the post or press “Without photo”.',
    'Yangi miqdorni kiriting (qoshish uchun).': 'Enter the new amount (for adding).',
    'Yangi miqdorni kiriting (ayirish uchun).': 'Enter the new amount (for subtracting).'
  },
  ru: {
    'Ruxsat yo\'q.': 'Нет доступа.', 'Kanal topilmadi.': 'Канал не найден.', 'Post uchun rasm yuboring.': 'Отправьте фото для поста.',
    'Tugma matnini yuboring:': 'Отправьте текст кнопки:', 'Tugma rangini tanlang:': 'Выберите цвет кнопки:', 'Amal bekor qilindi.': 'Действие отменено.',
    'Kanalni tanlang:': 'Выберите канал:', 'Kanal username sini yuboring, masalan: @my_channel': 'Отправьте username канала, например: @my_channel',
    'Izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:': 'Подпись сохранена. Можно добавить URL-кнопки:', 'Post tayyor. Havolali tugmalar qo\'shishingiz mumkin:': 'Пост готов. Можно добавить URL-кнопки:',
    'Havola http:// yoki https:// bilan boshlanishi kerak. Qayta yuboring:': 'Ссылка должна начинаться с http:// или https://. Отправьте ещё раз:', 'Kerakli amalni pastki menyudan tanlang.': 'Выберите действие в меню.',
    'Broadcast boshlanmagan.': 'Рассылка не начата.', 'Broadcast izohini yuboring:': 'Отправьте подпись рассылки:', 'Rasm saqlandi. Broadcast izohini yuboring:': 'Фото сохранено. Отправьте подпись рассылки:',
    'Post ma\'lumotlari topilmadi.': 'Данные поста не найдены.', 'Broadcast mazmuni topilmadi.': 'Содержимое рассылки не найдено.', 'Texnik xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.': 'Произошла техническая ошибка. Попробуйте позже.',
    'Assalomu alaykum! Kanal postlarini boshqarish botiga xush kelibsiz.': 'Добро пожаловать в бот управления постами каналов.', 'Rasm va izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:': 'Фото и подпись сохранены. Можно добавить URL-кнопки:', 'Endi post izohini yuboring yoki «Izohsiz» tugmasini bosing.': 'Отправьте подпись поста или нажмите «Без подписи».', 'Avval post yaratishni boshlang.': 'Сначала начните создание поста.', 'Tugma ma\'lumotlari topilmadi. Qaytadan boshlang.': 'Данные кнопки не найдены. Начните заново.', 'Rangli tugma qo\'shildi. Yana tugma qo\'shasizmi yoki postni yuboramizmi?': 'Цветная кнопка добавлена. Добавить ещё или отправить пост?', 'Majburiy obuna kanalining public username sini yuboring, masalan: @my_channel': 'Отправьте username канала обязательной подписки, например: @my_channel', 'Broadcast uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Отправьте фото рассылки или нажмите «Без фото».', 'Tugma havolasini yuboring (https://...):': 'Отправьте URL кнопки (https://...):',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Отправьте фото для поста или нажмите «Без фото».',
    'Yangi miqdorni kiriting (qoshish uchun).': 'Введите новую сумму (для пополнения).',
    'Yangi miqdorni kiriting (ayirish uchun).': 'Введите новую сумму (для списания).'
  },
  tr: {
    'Ruxsat yo\'q.': 'Erişim yok.', 'Kanal topilmadi.': 'Kanal bulunamadı.', 'Post için rasm yuboring.': 'Gönderi için fotoğraf gönderin.', 'Tugma matnini yuboring:': 'Buton metnini gönderin:', 'Tugma rangini tanlang:': 'Buton rengini seçin:', 'Amal bekor qilindi.': 'İşlem iptal edildi.', 'Kanalni tanlang:': 'Bir kanal seçin:', 'Kerakli amalni pastki menyudan tanlang.': 'Menüden bir işlem seçin:', 'Broadcast izohini yuboring:': 'Yayın açıklamasını gönderin:', 'Post ma\'lumotlari topilmadi.': 'Gönderi bilgileri bulunamadı.',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Gönderi için fotoğraf gönderin veya «Resimsiz» butonuna basın.',
    'Yangi miqdorni kiriting (qoshish uchun).': 'Yeni tutarı girin (ekleme için).',
    'Yangi miqdorni kiriting (ayirish uchun).': 'Yeni tutarı girin (çıkarma için).'
  },
  ar: { 'Ruxsat yo\'q.': 'لا يوجد صلاحية.', 'Kanal topilmadi.': 'لم يتم العثور على القناة.', 'Post uchun rasm yuboring.': 'أرسل صورة للمنشور.', 'Amal bekor qilindi.': 'تم إلغاء العملية.', 'Kanalni tanlang:': 'اختر قناة:', 'Tugma matnini yuboring:': 'أرسل نص الزر:', 'Tugma rangini tanlang:': 'اختر لون الزر:',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'أرسل صورة للمنشور أو اضغط على «بدون صورة».',
    'Yangi miqdorni kiriting (qoshish uchun).': 'أدخل المبلغ الجديد (لإضافة).',
    'Yangi miqdorni kiriting (ayirish uchun).': 'أدخل المبلغ الجديد (للخصم).' },
  zh: { 'Ruxsat yo\'q.': '无权限。', 'Kanal topilmadi.': '未找到频道。', 'Post uchun rasm yuboring.': '请发送帖子图片。', 'Amal bekor qilindi.': '操作已取消。', 'Kanalni tanlang:': '请选择频道：', 'Tugma matnini yuboring:': '请发送按钮文字：', 'Tugma rangini tanlang:': '请选择按钮颜色：',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': '请发送帖子图片，或按“无图”。',
    'Yangi miqdorni kiriting (qoshish uchun).': '输入新金额（用于加款）。',
    'Yangi miqdorni kiriting (ayirish uchun).': '输入新金额（用于扣款）。' },
  ko: { 'Ruxsat yo\'q.': '권한이 없습니다.', 'Kanal topilmadi.': '채널을 찾을 수 없습니다.', 'Post uchun rasm yuboring.': '게시물 사진을 보내세요.', 'Amal bekor qilindi.': '작업이 취소되었습니다.', 'Kanalni tanlang:': '채널을 선택하세요:', 'Tugma matnini yuboring:': '버튼 문구를 보내세요:', 'Tugma rangini tanlang:': '버튼 색상을 선택하세요:',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': '게시물 사진을 보내거나 “사진 없음” 버튼을 누르세요.',
    'Yangi miqdorni kiriting (qoshish uchun).': '새 금액을 입력하세요 (추가용).',
    'Yangi miqdorni kiriting (ayirish uchun).': '새 금액을 입력하세요 (차감용).' },
  tg: { 'Ruxsat yo\'q.': 'Иҷозат нест.', 'Kanal topilmadi.': 'Канал ёфт нашуд.', 'Post uchun rasm yuboring.': 'Барои пост акс фиристед.', 'Amal bekor qilindi.': 'Амалиёт бекор шуд.', 'Kanalni tanlang:': 'Каналро интихоб кунед:', 'Tugma matnini yuboring:': 'Матни тугмаро фиристед:', 'Tugma rangini tanlang:': 'Ранги тугмаро интихоб кунед:',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': 'Барои пост акс фиристед ё тугмаи «Бе акс» -ро пахш кунед.',
    'Yangi miqdorni kiriting (qoshish uchun).': 'Миқдори навро ворид кунед (барои илова).',
    'Yangi miqdorni kiriting (ayirish uchun).': 'Миқдори навро ворид кунед (барои кам кардан).' }
};
const keyboardTranslations = {
  en: { '➕ Kanal qo\'shish': '➕ Add channel', '✍️ Post yaratish': '✍️ Create post', '🗑 Kanalni o\'chirish': '🗑 Remove channel', '⬅️ Orqaga': '⬅️ Back', '🔗 Havolali tugma qo\'shish': '🔗 Add URL button', '✅ Postni yuborish': '✅ Publish post', '❌ Bekor qilish': '❌ Cancel', '🔵 Ko\'k': '🔵 Blue', '🟢 Yashil': '🟢 Green', '🔴 Qizil': '🔴 Red', '📊 Statistika': '📊 Statistics', '📣 Barchaga post yuborish': '📣 Broadcast post', '📢 Majburiy obunani sozlash': '📢 Set required subscription', '❌ Majburiy obunani o\'chirish': '❌ Disable required subscription', '📢 Kanalga obuna bo\'lish': '📢 Subscribe to channel', '✅ Obunani tekshirish': '✅ Check subscription' },
  ru: { '➕ Kanal qo\'shish': '➕ Добавить канал', '✍️ Post yaratish': '✍️ Создать пост', '🗑 Kanalni o\'chirish': '🗑 Удалить канал', '⬅️ Orqaga': '⬅️ Назад', '🔗 Havolali tugma qo\'shish': '🔗 Добавить URL-кнопку', '✅ Postni yuborish': '✅ Опубликовать', '❌ Bekor qilish': '❌ Отмена', '🔵 Ko\'k': '🔵 Синий', '🟢 Yashil': '🟢 Зелёный', '🔴 Qizil': '🔴 Красный', '📊 Statistika': '📊 Статистика', '📣 Barchaga post yuborish': '📣 Рассылка поста', '📢 Majburiy obunani sozlash': '📢 Настроить подписку', '❌ Majburiy obunani o\'chirish': '❌ Отключить подписку', '📢 Kanalga obuna bo\'lish': '📢 Подписаться', '✅ Obunani tekshirish': '✅ Проверить подписку' },
  tr: { '➕ Kanal qo\'shish': '➕ Kanal ekle', '✍️ Post yaratish': '✍️ Gönderi oluştur', '🗑 Kanalni o\'chirish': '🗑 Kanalı sil', '⬅️ Orqaga': '⬅️ Geri', '🔗 Havolali tugma qo\'shish': '🔗 URL butonu ekle', '✅ Postni yuborish': '✅ Gönderiyi yayınla', '❌ Bekor qilish': '❌ İptal', '🔵 Ko\'k': '🔵 Mavi', '🟢 Yashil': '🟢 Yeşil', '🔴 Qizil': '🔴 Kırmızı', '📊 Statistika': '📊 İstatistik', '📣 Barchaga post yuborish': '📣 Herkese gönder', '📢 Majburiy obunani sozlash': '📢 Zorunlu abonelik', '📋 Majburiy obuna kanallar ro\'yxati': '📋 Zorunlu abonelik kanalları listesi', '❌ Majburiy obunani o\'chirish': '❌ Aboneliği kapat', '📢 Kanalga obuna bo\'lish': '📢 Kanala abone ol', '✅ Obunani tekshirish': '✅ Aboneliği kontrol et' },
  ar: { '➕ Kanal qo\'shish': '➕ إضافة قناة', '✍️ Post yaratish': '✍️ إنشاء منشور', '🗑 Kanalni o\'chirish': '🗑 حذف القناة', '⬅️ Orqaga': '⬅️ رجوع', '🔗 Havolali tugma qo\'shish': '🔗 إضافة زر رابط', '✅ Postni yuborish': '✅ نشر المنشور', '❌ Bekor qilish': '❌ إلغاء', '🔵 Ko\'k': '🔵 أزرق', '🟢 Yashil': '🟢 أخضر', '🔴 Qizil': '🔴 أحمر', '📊 Statistika': '📊 الإحصائيات', '📣 Barchaga post yuborish': '📣 إرسال للجميع', '📢 Majburiy obunani sozlash': '📢 إعداد الاشتراك', '❌ Majburiy obunani o\'chirish': '❌ تعطيل الاشتراك', '📢 Kanalga obuna bo\'lish': '📢 اشترك بالقناة', '✅ Obunani tekshirish': '✅ تحقق من الاشتراك' },
  zh: { '➕ Kanal qo\'shish': '➕ 添加频道', '✍️ Post yaratish': '✍️ 创建帖子', '🗑 Kanalni o\'chirish': '🗑 删除频道', '⬅️ Orqaga': '⬅️ 返回', '🔗 Havolali tugma qo\'shish': '🔗 添加链接按钮', '✅ Postni yuborish': '✅ 发布帖子', '❌ Bekor qilish': '❌ 取消', '🔵 Ko\'k': '🔵 蓝色', '🟢 Yashil': '🟢 绿色', '🔴 Qizil': '🔴 红色', '📊 Statistika': '📊 统计', '📣 Barchaga post yuborish': '📣 广播帖子', '📢 Majburiy obunani sozlash': '📢 设置强制订阅', '❌ Majburiy obunani o\'chirish': '❌ 关闭强制订阅', '📢 Kanalga obuna bo\'lish': '📢 订阅频道', '✅ Obunani tekshirish': '✅ 检查订阅' },
  ko: { '➕ Kanal qo\'shish': '➕ 채널 추가', '✍️ Post yaratish': '✍️ 게시물 만들기', '🗑 Kanalni o\'chirish': '🗑 채널 삭제', '⬅️ Orqaga': '⬅️ 뒤로', '🔗 Havolali tugma qo\'shish': '🔗 URL 버튼 추가', '✅ Postni yuborish': '✅ 게시물 게시', '❌ Bekor qilish': '❌ 취소', '🔵 Ko\'k': '🔵 파란색', '🟢 Yashil': '🟢 초록색', '🔴 Qizil': '🔴 빨간색', '📊 Statistika': '📊 통계', '📣 Barchaga post yuborish': '📣 전체 방송', '📢 Majburiy obunani sozlash': '📢 필수 구독 설정', '❌ Majburiy obunani o\'chirish': '❌ 필수 구독 해제', '📢 Kanalga obuna bo\'lish': '📢 채널 구독', '✅ Obunani tekshirish': '✅ 구독 확인' },
  tg: { '➕ Kanal qo\'shish': '➕ Иловаи канал', '✍️ Post yaratish': '✍️ Эҷоди пост', '🗑 Kanalni o\'chirish': '🗑 Нест кардани канал', '⬅️ Orqaga': '⬅️ Бозгашт', '🔗 Havolali tugma qo\'shish': '🔗 Иловаи тугмаи пайванд', '✅ Postni yuborish': '✅ Нашри пост', '❌ Bekor qilish': '❌ Бекор кардан', '🔵 Ko\'k': '🔵 Кабуд', '🟢 Yashil': '🟢 Сабз', '🔴 Qizil': '🔴 Сурх', '📊 Statistika': '📊 Омори', '📣 Barchaga post yuborish': '📣 Ирсол ба ҳама', '📢 Majburiy obunani sozlash': '📢 Танзими обуна', '❌ Majburiy obunani o\'chirish': '❌ Хомӯш кардани обуна', '📢 Kanalga obuna bo\'lish': '📢 Обуна ба канал', '✅ Obunani tekshirish': '✅ Санҷиши обуна' }
};
for (const language of Object.keys(languages)) {
  keyboardTranslations[language] ||= {};
  keyboardTranslations[language]['🛠 Admin panel'] ||= text.admin[language];
}
const previewLabels = {
  uz: ['👀 Preview', '✅ Tasdiqlash'], en: ['👀 Preview', '✅ Confirm'], ru: ['👀 Предпросмотр', '✅ Подтвердить'],
  tr: ['👀 Önizleme', '✅ Onayla'], ar: ['👀 معاينة', '✅ تأكيد'], zh: ['👀 预览', '✅ 确认'], ko: ['👀 미리보기', '✅ 확인'], tg: ['👀 Пешнамоиш', '✅ Тасдиқ']
};
for (const [language, labels] of Object.entries(previewLabels)) {
  keyboardTranslations[language]['👀 Preview'] = labels[0];
  keyboardTranslations[language]['✅ Tasdiqlash'] = labels[1];
}
function localizeReply(ctx, message) {
  const lang = userLanguage(ctx);
  const translated = replyTranslations[lang]?.[message] || keyboardTranslations[lang]?.[message] || message;
  const prefixMap = {
    'Kanalni tanlang:': '<tg-emoji emoji-id="5424818078833715060">📣</tg-emoji>',
    'Post uchun rasm yuboring yoki «Rasmsiz» tugmasini bosing.': '<tg-emoji emoji-id="5397916757333654639">➕</tg-emoji>'
  };
  const prefix = prefixMap[message] || prefixMap[translated];
  return prefix ? `${prefix} ${translated}` : translated;
}
data.settings.requiredChannels ||= [];
data.settings.premiumCardNumber ||=  '9860 0803 9258 5933';
data.settings.premiumPrice ||= 10000;
data.stats = { postsSent: 0, broadcastsSent: 0 };

let mongoWriteQueue = Promise.resolve();

function saveData() {
  mongoWriteQueue = mongoWriteQueue.then(async () => {
    const userOperations = Object.entries(data.users).map(([telegramId, account]) => ({
      updateOne: {
        filter: { telegramId: Number(telegramId) },
        update: { $set: { ...account, telegramId: Number(telegramId) } },
        upsert: true
      }
    }));
    if (userOperations.length) await User.bulkWrite(userOperations, { ordered: false });
    await BotConfig.updateOne({ configKey: 'main_config' }, {
      $set: {
        channels: data.settings.requiredChannels || [],
        settings: data.settings,
        stats: data.stats,
      }
    }, { upsert: true });
  }).catch((error) => {
    console.error('MongoDB persistence failed:', error.message);
  });
  return mongoWriteQueue;
}

function accountFromMongo(document) {
  const account = { ...document };
  delete account._id;
  delete account.__v;
  return account;
}

async function hydrateFromMongo() {
  await mongoConnection;
  let config = await BotConfig.findOne({ configKey: 'main_config' }).lean();
  const existingUsers = await User.countDocuments();

  if (!config && existingUsers === 0 && Object.keys(legacyData.users || {}).length) {
    const legacyUsers = Object.entries(legacyData.users).map(([telegramId, account]) => ({
      updateOne: {
        filter: { telegramId: Number(telegramId) },
        update: { $set: { ...account, telegramId: Number(telegramId), joinedAt: account.joinedAt || new Date() } },
        upsert: true
      }
    }));
    await User.bulkWrite(legacyUsers, { ordered: false });
  }

  if (!config) {
    const legacySettings = legacyData.settings || {};
    if (legacySettings.requiredChannel && !Array.isArray(legacySettings.requiredChannels)) {
      legacySettings.requiredChannels = [legacySettings.requiredChannel];
    }
    config = await BotConfig.create({
      configKey: 'main_config',
      channels: legacySettings.requiredChannels || [],
      settings: legacySettings,
      stats: legacyData.stats || { postsSent: 0, broadcastsSent: 0 },
    });
    config = config.toObject();
  }

  const accounts = await User.find({}).lean();
  data.users = Object.fromEntries(accounts.map((account) => [String(account.telegramId), accountFromMongo(account)]));
  data.settings = { ...data.settings, ...(config.settings || {}) };
  data.settings.requiredChannels = config.channels?.length ? config.channels : (data.settings.requiredChannels || []);
  data.stats = { ...data.stats, ...(config.stats || {}) };
  data.settings.requiredChannels ||= [];
  data.settings.premiumCardNumber ||= '9860 0803 9258 5933';
  data.settings.premiumPrice ||= 10000;
}

function userData(userId) {
  const key = String(userId);
  if (!data.users[key]) {
    const usedIds = Object.values(data.users || {})
      .map((item) => Number(item.personalId))
      .filter((id) => Number.isFinite(id));
    const nextId = usedIds.length ? Math.max(...usedIds) + 1 : 1728000;

    data.users[key] = {
      channels: [],
      language: null,
      personalId: nextId,
      username: '',
      nickname: '',
      premium: false,
      postLog: [],
      templates: [],
      publishedPosts: 0,
      publishedChannels: 0,
      lastPublishedAt: null,
      postStats: [],
      profileSeen: false
    };
  }

  data.users[key].channels ||= [];
  data.users[key].language ||= null;
  data.users[key].premium ??= false;
  data.users[key].postLog ||= [];
  data.users[key].templates ||= [];
  data.users[key].publishedPosts ||= 0;
  data.users[key].publishedChannels ||= 0;
  data.users[key].lastPublishedAt ||= null;
  data.users[key].postStats ||= [];
  data.users[key].profileSeen ??= false;

  if (!data.users[key].personalId || String(data.users[key].personalId).length !== 7) {
    const usedIds = Object.values(data.users || {})
      .map((item) => Number(item.personalId))
      .filter((id) => Number.isFinite(id));
    const nextId = usedIds.length ? Math.max(...usedIds) + 1 : 1728000;
    data.users[key].personalId = nextId;
  }

  return data.users[key];
}

function userLanguage(ctx) {
  return userData(ctx.from.id).language || 'uz';
}

async function ensureUserInMongo(ctx, includeReferral = false) {
  const telegramId = Number(ctx.from.id);
  const referralValue = Number(ctx.startPayload);
  const referredBy = includeReferral && Number.isSafeInteger(referralValue) && referralValue !== telegramId
    ? referralValue
    : null;
  const update = {
    $set: {
      username: ctx.from.username || '',
      nickname: ctx.from.first_name || ctx.from.last_name || ''
    },
    $setOnInsert: {
      telegramId,
      joinedAt: new Date(),
      referredBy,
    }
  };
  const document = await User.findOneAndUpdate({ telegramId }, update, {
    upsert: true,
    new: true,
    setDefaultsOnInsert: true
  }).lean();
  data.users[String(telegramId)] = accountFromMongo(document);
  userData(telegramId);
  return data.users[String(telegramId)];
}

function tr(ctx, key, fallback = key) {
  return text[key]?.[userLanguage(ctx)] || text[key]?.uz || fallback;
}

function languageKeyboard() {
  const entries = Object.entries(languages);
  const rows = [];
  for (let i = 0; i < entries.length; i += 4) {
    rows.push(entries.slice(i, i + 4).map(([code, name]) => Markup.button.callback(name, `language:${code}`)));
  }
  return Markup.inlineKeyboard(rows);
}

function isAdmin(ctx) {
  return ctx.from?.username?.toLowerCase() === ADMIN_USERNAME;
}

function mainKeyboard(ctx) {
  if (isAdmin(ctx)) return Markup.keyboard([[tr(ctx, 'admin')]]).resize();
  return Markup.removeKeyboard();
}

function adminKeyboard(ctx) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(localizeReply(ctx, '📢 Majburiy obunani sozlash'), 'admin:subscription')],
    [Markup.button.callback(localizeReply(ctx, '📋 Majburiy obuna kanallar ro\'yxati'), 'admin:required_list')],
    [Markup.button.callback(localizeReply(ctx, '❌ Majburiy obunani o\'chirish'), 'admin:subscription_off')],
    [Markup.button.callback('🔍 Userni qidirish', 'admin:user_search')]
  ]);
}
function subscriptionKeyboard(ctx, channels) {
  const requiredChannels = Array.isArray(channels) ? channels : [channels];
  return Markup.inlineKeyboard([
    ...requiredChannels.map((channel) => [Markup.button.url(
      `${localizeReply(ctx, '📢 Kanalga obuna bo\'lish')} ${channel.title || channel.username}`,
      `https://t.me/${channel.username.replace(/^@/, '')}`
    )]),
    [Markup.button.callback(localizeReply(ctx, '✅ Obunani tekshirish'), 'check_subscription')]
  ]);
}

async function statsText() {
  const totalUsers = await User.countDocuments();
  const channelResult = await User.aggregate([
    { $project: { channelCount: { $size: { $ifNull: ['$channels', []] } } } },
    { $group: { _id: null, total: { $sum: '$channelCount' } } }
  ]);
  const channels = channelResult[0]?.total || 0;
  const posts = data.stats.postsSent || 0;
  const broadcasts = data.stats.broadcastsSent || 0;
  return { uz: `📊 Bot statistikasi\n\n👤 Barcha foydalanuvchilar: ${totalUsers}\n📢 Barcha kanallar: ${channels}\n📨 Yuborilgan postlar: ${posts}\n📣 Broadcastlar: ${broadcasts}`, en: `📊 Bot statistics\n\n👤 All users: ${totalUsers}\n📢 All channels: ${channels}\n📨 Posts sent: ${posts}\n📣 Broadcasts: ${broadcasts}`, ru: `📊 Статистика бота\n\n👤 Все пользователи: ${totalUsers}\n📢 Все каналы: ${channels}\n📨 Отправлено постов: ${posts}\n📣 Рассылки: ${broadcasts}`, tr: `📊 Bot istatistikası\n\n👤 Tüm kullanıcılar: ${totalUsers}\n📢 Tüm kanallar: ${channels}\n📨 Gönderilen gönderiler: ${posts}\n📣 Yayınlar: ${broadcasts}`, ar: `📊 إحصائيات البوت\n\n👤 جميع المستخدمين: ${totalUsers}\n📢 جميع القنوات: ${channels}\n📨 المنشورات المرسلة: ${posts}\n📣 الإرسالات: ${broadcasts}`, zh: `📊 机器人统计\n\n👤 用户总数：${totalUsers}\n📢 频道总数：${channels}\n📨 已发送帖子：${posts}\n📣 广播：${broadcasts}`, ko: `📊 봇 통계\n\n👤 전체 사용자: ${totalUsers}\n📢 전체 채널: ${channels}\n📨 보낸 게시물: ${posts}\n📣 방송: ${broadcasts}`, tg: `📊 Омори бот\n\n👤 Ҳамаи корбарон: ${totalUsers}\n📢 Ҳамаи каналҳо: ${channels}\n📨 Постҳои фиристодашуда: ${posts}\n📣 Ирсолҳо: ${broadcasts}` };
}

async function requiredSubscription(ctx) {
  if (isAdmin(ctx)) return true;
  const channels = await getRequiredChannels();
  if (!channels.length) return true;

  const notSubscribed = [];
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
      if (!['creator', 'administrator', 'member'].includes(member.status)) {
        notSubscribed.push(channel);
      }
    } catch (error) {
      console.error('Subscription check failed:', error.response?.description || error.message);
      notSubscribed.push(channel);
    }
  }

  if (!notSubscribed.length) return true;
  await ctx.reply('Botdan foydalanish uchun majburiy kanallarga obuna bo\'ling.', subscriptionKeyboard(ctx, notSubscribed));
  return false;
}

async function checkRequiredSubscriptionChannel(ctx, username) {
  const chat = await ctx.telegram.getChat(username);
  if (chat.type !== 'channel' || !chat.username) throw new Error('Public username’li kanal yuboring.');
  const botInfo = await ctx.telegram.getMe();
  const member = await ctx.telegram.getChatMember(chat.id, botInfo.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    throw new Error('Bot majburiy obuna kanalida administrator bo\'lishi kerak.');
  }
  return { id: chat.id, title: chat.title || username, username: `@${chat.username}` };
}

async function getRequiredChannels() {
  const config = await BotConfig.findOne({ configKey: 'main_config' }, { channels: 1 }).lean();
  if (config?.channels) return config.channels;
  const list = Array.isArray(data.settings?.requiredChannels) ? data.settings.requiredChannels : [];
  if (data.settings?.requiredChannel && !list.some((item) => item.id === data.settings.requiredChannel.id)) {
    list.push(data.settings.requiredChannel);
  }
  return list;
}

async function formatRequiredChannelList() {
  const channels = await getRequiredChannels();
  if (!channels.length) return 'Majburiy obuna kanallari yo\'q.';
  return channels.map((channel) => `${channel.title || channel.username} (${channel.username || ''})`).join('\n');
}

async function sendBroadcastToChat(ctx, chatId, post, replyMarkup) {
  await sendPostToChat(ctx, chatId, post, replyMarkup);
}

async function broadcastPost(ctx, post) {
  const accounts = await User.find({}, { telegramId: 1, channels: 1 }).lean();
  const requiredChannels = await getRequiredChannels();
  const userIds = new Set(accounts.map((account) => String(account.telegramId)));
  const channelIds = new Set();

  for (const account of accounts) {
    for (const channel of account.channels || []) {
      if (channel?.id) channelIds.add(String(channel.id));
    }
  }

  for (const channel of requiredChannels) {
    if (channel?.id) channelIds.add(String(channel.id));
  }

  const buttons = post.finalButtons || postButtons(post);
  const replyMarkup = Markup.inlineKeyboard(buttons).reply_markup;
  let sent = 0;

  const channelResults = await runWithConcurrency([...channelIds], 5, async (chatId) => {
    await sendBroadcastToChat(ctx, chatId, post, replyMarkup);
    return true;
  });
  sent += channelResults.filter((result) => result.status === 'fulfilled').length;
  channelResults.filter((result) => result.status === 'rejected').forEach((result) => {
    console.error('Broadcast to channel failed:', result.reason?.response?.description || result.reason?.message);
  });

  const userResults = await runWithConcurrency([...userIds], 5, async (chatId) => {
    for (const required of requiredChannels) {
      if (!required?.id) continue;
      const member = await ctx.telegram.getChatMember(required.id, Number(chatId));
      if (!['creator', 'administrator', 'member'].includes(member.status)) return false;
    }
    await sendBroadcastToChat(ctx, chatId, post, replyMarkup);
    return true;
  });
  sent += userResults.filter((result) => result.status === 'fulfilled' && result.value).length;
  userResults.filter((result) => result.status === 'rejected').forEach((result) => {
    console.error('Broadcast to user failed:', result.reason?.response?.description || result.reason?.message);
  });

  data.stats.broadcastsSent += 1;
  data.stats.postsSent += sent;
  await saveData();
  return sent;
}

async function runWithConcurrency(items, limit, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function channelKeyboard(ctx, channels) {
  return Markup.inlineKeyboard([
    ...channels.map((channel) => [Markup.button.callback(`📢 ${channel.title}`, `channel:${channel.id}`)]),
    [Markup.button.callback('📢 Bir nechta kanalga yuborish', 'compose_multi')],
    [Markup.button.callback(localizeReply(ctx, '➕ Kanal qo\'shish'), 'add_channel')]
  ]);
}

function multiChannelKeyboard(ctx, channels, selectedIds = []) {
  const selected = new Set(selectedIds.map((id) => String(id)));
  return Markup.inlineKeyboard([
    ...channels.map((channel) => [Markup.button.callback(
      `${selected.has(String(channel.id)) ? '✅' : '⬜'} ${channel.title}`,
      `multi_channel:${channel.id}`
    )]),
    [Markup.button.callback('✅ Kanallarni tasdiqlash', 'multi_channels_done')],
    [Markup.button.callback(localizeReply(ctx, '❌ Bekor qilish'), 'cancel')]
  ]);
}

function channelActions(ctx, channelId) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(localizeReply(ctx, '✍️ Post yaratish'), `compose:${channelId}`)],
    [Markup.button.callback(localizeReply(ctx, '🗑 Kanalni o\'chirish'), `remove:${channelId}`)],
    [Markup.button.callback(localizeReply(ctx, '⬅️ Orqaga'), 'channels')]
  ]);
}

function composerKeyboard(ctx) {
  return Markup.removeKeyboard();
}

function templateKeyboard(templates) {
  return Markup.inlineKeyboard([
    ...templates.map((template) => [Markup.button.callback(`📄 ${template.name}`, `template:${template.id}`)]),
  ]);
}

function postButtons(post) {
  return post.buttons || [];
}

function postHasContent(post) {
  return Boolean(post?.photo || post?.media || post?.caption);
}

async function sendPostToChat(ctx, chatId, post, replyMarkup) {
  const common = { reply_markup: replyMarkup };
  if (post.photo || post.mediaType === 'photo') {
    return ctx.telegram.sendPhoto(chatId, post.photo || post.media, {
      ...common,
      caption: post.caption || undefined,
      caption_entities: post.caption ? post.captionEntities : undefined
    });
  }
  if (post.mediaType === 'video') {
    return ctx.telegram.sendVideo(chatId, post.media, {
      ...common,
      caption: post.caption || undefined,
      caption_entities: post.caption ? post.captionEntities : undefined,
      supports_streaming: true
    });
  }
  if (post.mediaType === 'animation') {
    return ctx.telegram.sendAnimation(chatId, post.media, {
      ...common,
      caption: post.caption || undefined,
      caption_entities: post.caption ? post.captionEntities : undefined
    });
  }
  if (post.mediaType === 'document') {
    return ctx.telegram.sendDocument(chatId, post.media, {
      ...common,
      caption: post.caption || undefined,
      caption_entities: post.caption ? post.captionEntities : undefined
    });
  }
  return ctx.telegram.sendMessage(chatId, post.caption || ' ', {
    ...common,
    entities: post.captionEntities || undefined
  });
}

async function sendPreview(ctx) {
  const { post } = ctx.session;
  if (!postHasContent(post)) return ctx.reply('Post ma\'lumotlari topilmadi.');
  ctx.session.previewButtons = postButtons(post);
  const replyMarkup = Markup.inlineKeyboard(ctx.session.previewButtons).reply_markup;
  ctx.session.step = 'confirm';
  await sendPostToChat(ctx, ctx.from.id, post, replyMarkup);
  return ctx.reply('👀 Preview tayyor. Yuborishni tasdiqlaysizmi?', confirmationKeyboard(ctx));
}

function downloadWithYtDlp(output, url) {
  return new Promise((resolve, reject) => {
    const child = spawn('yt-dlp', [
      '--no-playlist',
      '--max-filesize', '100M',
      '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '-o', output,
      url
    ], { windowsHide: true });
    let errorOutput = '';
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('yt-dlp timeout'));
    }, 120000);
    child.stderr?.on('data', (chunk) => {
      errorOutput += chunk.toString();
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && fs.existsSync(output)) return resolve(output);
      reject(new Error(errorOutput.trim() || `yt-dlp exited with code ${code}`));
    });
  });
}

async function sendMediaFromUrl(ctx, url) {
  const lower = String(url).trim().toLowerCase();
  const botAddress = getBotPublicLink();
  const footer = `\n\n📍 Bot manzili: ${botAddress}`;

  try {
    if (/youtube\.com|youtu\.be|instagram\.com|instagr\.am|tiktok\.com|x\.com|twitter\.com|fb\.com|facebook\.com|vk\.com|vimeo\.com/.test(lower)) {
      const output = path.join(__dirname, 'tmp-media', `media-${Date.now()}.mp4`);
      await fs.promises.mkdir(path.dirname(output), { recursive: true });
      await downloadWithYtDlp(output, url);
      try {
        await ctx.telegram.sendVideo(ctx.chat.id, { source: fs.createReadStream(output), filename: 'media.mp4' }, { caption: footer, supports_streaming: true });
        return ctx.reply('✅ Video yuborildi.', mainKeyboard(ctx));
      } finally {
        await fs.promises.unlink(output).catch(() => {});
      }
    }

    if (/\.(mp4|mov|m4v|webm|ogg|avi)(\?|$)/.test(lower)) {
      await ctx.telegram.sendVideo(ctx.chat.id, url, { caption: footer, supports_streaming: true });
      return ctx.reply('✅ Video yuborildi.', mainKeyboard(ctx));
    }

    if (/\.(jpg|jpeg|png|gif|webp|bmp)(\?|$)/.test(lower)) {
      await ctx.telegram.sendPhoto(ctx.chat.id, url, { caption: footer });
      return ctx.reply('✅ Rasm yuborildi.', mainKeyboard(ctx));
    }

    return ctx.reply('Iltimos, rasm yoki video URL yuboring.', mainKeyboard(ctx));
  } catch (error) {
    console.error('Media send failed:', error);
    return ctx.reply('Media URL ni yuborishda xatolik yuz berdi.', mainKeyboard(ctx));
  }
}

function buttonColorKeyboard(ctx) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔵 Ko\'k', 'button_color:blue')],
    [Markup.button.callback('🟢 Yashil', 'button_color:green')],
    [Markup.button.callback('🔴 Qizil', 'button_color:red')],
    [Markup.button.callback(localizeReply(ctx, '❌ Bekor qilish'), 'cancel')]
  ]);
}

function buttonPlacementKeyboard(ctx) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('➕ Yangi qatorga qo\'shish', 'button_place:new')],
    [Markup.button.callback('↔️ Shu qatorga qo\'shish', 'button_place:same')],
    [Markup.button.callback(localizeReply(ctx, '❌ Bekor qilish'), 'cancel')]
  ]);
}

function isUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'tg:';
  } catch {
    return false;
  }
}

function normalizeChannel(value) {
  const trimmed = value.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function getBotPublicLink() {
  return config.botLink;
}

function normalizePersonalId(value) {
  const input = String(value).trim();
  return input.replace(/\D/g, '');
}

function buildUserProfileText(user, fromId) {
  return `👤 Foydalanuvchi profili\n\n` +
    `Username: ${user.username || user.nickname || '—'}\n` +
    `Nickname: ${user.nickname || '—'}\n` +
    `Bot personal ID: ${user.personalId || '—'}\n` +
    `Telegram ID: ${fromId}`;
}

async function sendToAdmin(message) {
  try {
    const chat = await bot.telegram.getChat(ADMIN_USERNAME);
    return bot.telegram.sendMessage(chat.id, message);
  } catch (error) {
    console.error('Admin message send failed:', error.message);
  }
}

async function chargeOrAllowPost(ctx) {
  const account = userData(ctx.from.id);
  account.postLog ||= [];
  account.postLog.push(Date.now());
  saveData();
  return { ok: true };
}

async function findUserByPersonalId(id) {
  const target = String(id).trim();
  const account = await User.findOne({ personalId: Number(target) }).lean();
  if (!account) return null;
  return { key: String(account.telegramId), account: accountFromMongo(account) };
}

function buildProfileText(ctx) {
  const account = userData(ctx.from.id);
  const lang = userLanguage(ctx);
  const premiumText = Boolean(account.premium) ? `${text.premiumActive?.[lang] || 'Active'} ${text.premium?.[lang] || 'Premium'}` : `${text.premiumInactive?.[lang] || 'Inactive'} ${text.premium?.[lang] || 'Premium'}`;
  return `👤 ${text.profile?.[lang] || 'Profilim'}\n\n` +
    `${text.botId?.[lang] || 'Botdagi ID'}: ${account.personalId}\n` +
    `${text.telegramId?.[lang] || 'Telegram ID'}: ${ctx.from.id}\n` +
    `${text.username?.[lang] || 'Username'}: ${ctx.from.username || '—'}\n` +
    `${text.nickname?.[lang] || 'Nickname'}: ${ctx.from.first_name || '—'}\n` +
    `${text.premiumStatus?.[lang] || 'Premium status'}: ${premiumText}`;
}

async function handleStart(ctx) {
  const account = await ensureUserInMongo(ctx, true);
  if (!account.language) {
    account.language = 'uz';
    await User.updateOne({ telegramId: Number(ctx.from.id) }, { $set: { language: account.language } });
  }
  saveData();
  reset(ctx);
  if (!(await requiredSubscription(ctx))) return;
  if (!account.language) return ctx.reply(tr(ctx, 'welcome'), languageKeyboard());
  return ctx.reply('<tg-emoji emoji-id="5454380420336466255">✋</tg-emoji> Assalomu alaykum! Kino botiga xush kelibsiz. Kino kodini yuboring.', {
    parse_mode: 'HTML',
    reply_markup: mainKeyboard(ctx)
  });
}

async function sendAdminMessage(ctx, messageText) {
  try {
    const chat = await bot.telegram.getChat(ADMIN_PUBLIC_USERNAME);
    const account = userData(ctx.from.id);
    return bot.telegram.sendMessage(chat.id, `📬 Adminga murojaat\n\n` +
      `Foydalanuvchi: ${ctx.from.username || ctx.from.first_name || ctx.from.id}\n` +
      `Bot personal ID: ${account.personalId || '—'}\n` +
      `Telegram ID: ${ctx.from.id}\n\n` +
      `${messageText}`);
  } catch (error) {
    console.error('Admin message send failed:', error.response?.description || error.message);
  }
}

async function chargeForPostIfNeeded(ctx) {
  const account = userData(ctx.from.id);
  if (account.premium) {
    account.postLog ||= [];
    account.postLog.push(Date.now());
    saveData();
    return { ok: true };
  }

  const now = Date.now();
  const windowStart = now - 24 * 60 * 60 * 1000;
  const recentLog = Array.isArray(account.postLog) ? account.postLog.filter((ts) => Number(ts) >= windowStart) : [];
  account.postLog = recentLog;
  if (recentLog.length >= 3) {
    return { ok: false, message: `<tg-emoji emoji-id="5084974483685507801">💜</tg-emoji> ${tr(ctx, 'Limit tugadi. Premium ta`rifni sotib oling!')}` };
  }

  account.postLog.push(now);
  saveData();
  return { ok: true };
}



function buildPremiumText(ctx) {
  const account = userData(ctx.from.id);
  const lang = userLanguage(ctx);
  const status = Boolean(account.premium)
    ? `${text.premiumActive?.[lang] || 'Active'} ${text.premium?.[lang] || 'Premium'}`
    : `${text.premiumInactive?.[lang] || 'Inactive'} ${text.premium?.[lang] || 'Premium'}`;
  const cardNumber = String(data.settings?.premiumCardNumber || '9860 0803 9258 5933').trim();
  const price = Number(data.settings?.premiumPrice || 10000);
  return `<tg-emoji emoji-id="5084974483685507801">💜</tg-emoji>  ${text.premium?.[lang] || 'Premium'}\n\n` +
    `<tg-emoji emoji-id="5370784581341422520">⭐️</tg-emoji> ${text.premiumStatus?.[lang] || 'Premium status'}: ${status}\n` +
    `<tg-emoji emoji-id="5366082700253870225">♾️</tg-emoji> ${text.premiumFeaturePost?.[lang] || 'Unlimited posts'}\n` +
    `<tg-emoji emoji-id="5366082700253870225">♾️</tg-emoji> ${text.premiumFeatureChannel?.[lang] || 'Unlimited channels'}\n\n` +
    `📢 Bir postni bir nechta kanalga yuborish\n` +
    `📂 Post shablonlarini saqlash\n` +
    `🔘 Tugmalarni bir qatorga joylash\n` +
    `📊 Post statistikasi\n` +
    `🎞 Video, GIF va hujjat postlari\n\n` +
    `<tg-emoji emoji-id="5267300544094948794">💳</tg-emoji> To'lov kartasi: <code>${cardNumber}</code>\n` +
    `<tg-emoji emoji-id="5393290141253004429">🏧</tg-emoji> Humo plastik karta, ${price} so'm\n\n` +
    `<tg-emoji emoji-id="5373265917092316632">📱</tg-emoji> To'lovni amalga oshirgandan keyin quyidagi tugmani bosing:`;
}

function premiumInlineKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback("To'lov qildim ✅", 'premium_paid')]
  ]);
}

function premiumStatsText(ctx) {
  const account = userData(ctx.from.id);
  if (!account.premium) return 'Post statistikasi Premium foydalanuvchilar uchun mavjud.';
  const lastPublished = account.lastPublishedAt
    ? new Date(account.lastPublishedAt).toLocaleString('uz-UZ', { timeZone: BOT_TIMEZONE })
    : 'Hali post yuborilmagan';
  return `📊 Post statistikasi\n\n` +
    `Yuborilgan postlar: ${account.publishedPosts || 0} ta\n` +
    `Kanallarga yuborilgan nusxalar: ${account.publishedChannels || 0} ta\n` +
    `Saqlangan shablonlar: ${account.templates?.length || 0} ta\n` +
    `Saqlangan statistika yozuvlari: ${account.postStats?.length || 0} ta\n` +
    `Oxirgi post: ${lastPublished}`;
}

async function checkFullAdmin(ctx, username) {
  const chat = await ctx.telegram.getChat(username);
  if (chat.type !== 'channel') throw new Error('Bu username kanalga tegishli emas.');

  try {
    const userMember = await ctx.telegram.getChatMember(chat.id, ctx.from.id);
    if (!['creator', 'administrator'].includes(userMember.status)) {
      throw new Error('Kanalni qo\'shish uchun kanalda admin yoki ega bo\'lishingiz kerak.');
    }
  } catch (error) {
    throw new Error('Kanalni qo\'shish uchun kanalda admin yoki ega bo\'lishingiz kerak.');
  }

  const botInfo = await ctx.telegram.getMe();
  const member = await ctx.telegram.getChatMember(chat.id, botInfo.id);
  if (member.status !== 'administrator') {
    throw new Error('Bot kanalda administrator emas. Avval botni to\'liq admin qilib qo\'shing.');
  }

  const requiredPermissions = [
    'can_manage_chat', 'can_change_info', 'can_post_messages', 'can_edit_messages',
    'can_delete_messages', 'can_invite_users', 'can_restrict_members',
    'can_promote_members', 'can_manage_video_chats'
  ];
  const missing = requiredPermissions.filter((permission) => member[permission] !== true);
  if (missing.length) throw new Error('Bot to\'liq admin emas. Barcha administrator huquqlarini yoqing.');

  return { id: chat.id, title: chat.title || username, username: chat.username ? `@${chat.username}` : username };
}

async function showChannels(ctx) {
  const channels = userData(ctx.from.id).channels;
  if (!channels.length) {
    return ctx.reply('Sizda hali kanal yo\'q. Kanal username sini yuborish uchun «➕ Kanal qo\'shish» tugmasini bosing.', mainKeyboard(ctx));
  }
  return ctx.reply('Kanalni tanlang:', channelKeyboard(ctx, channels));
}

function reset(ctx) {
  ctx.session = {};
}

bot.use(session());

bot.use(async (ctx, next) => {
  const isStart = ctx.message?.text === '/start';
  if (ctx.from && !isStart) {
    const wasExisting = Boolean(await User.exists({ telegramId: Number(ctx.from.id) }));
    await ensureUserInMongo(ctx);
    if (!wasExisting && ctx.session) {
      ctx.session.justCreated = true;
    }
  }

  const originalReply = ctx.reply.bind(ctx);
  ctx.reply = (message, ...args) => {
    const localized = localizeReply(ctx, message);
      const enriched = prefixPremiumEmojiIfMissing(localized);
    if (enriched.includes('<tg-emoji')) {
      if (args.length === 0) return originalReply(enriched, { parse_mode: 'HTML' });
      const firstArg = args[0];
      if (firstArg && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
        return originalReply(enriched, { ...firstArg, parse_mode: 'HTML' });
      }
    }
    return originalReply(enriched, ...args);
  };
  const callbackData = ctx.callbackQuery?.data;
  const isSettings = ctx.message?.text === '/settings';
  if (isStart || isSettings || callbackData?.startsWith('language:') || callbackData === 'check_subscription' || isAdmin(ctx)) return next();

  if (await requiredSubscription(ctx)) {
    return next();
  }
});

// Legacy post and premium flows are disabled while the bot is being converted to a movie bot.
bot.use(async (ctx, next) => {
  const callbackData = ctx.callbackQuery?.data || '';
  const blockedCallback = /^(?:admin:(?:stats|broadcast|premium_.*|back)|channels|add_channel|compose.*|multi_channel.*|multi_channels_done|channel:.*|remove:.*|no_photo|no_caption|add_button|save_template|templates.*|template:.*|button_.*|preview|publish|cancel|premium:.*)$/.test(callbackData);
  const blockedCommand = /^\/(?:channels|profile|premium|settings)\b/i.test(ctx.message?.text || '');
  const blockedText = [
    ...Object.values(text.createPost),
    ...Object.values(text.videoSave),
    ...Object.values(text.channels),
    ...Object.values(text.addChannel),
    '📊 Post statistikasi', '👤 Profilim', '💎 Premium'
  ].includes(ctx.message?.text);
  const blockedSession = /^(?:media_url|channel|photo|broadcast_photo|broadcast_caption|caption|buttons|button_text|button_url|button_color|multi_channel_select|premium_payment_photo|admin_premium_)/.test(ctx.session?.step || '');
  const hasMedia = Boolean(ctx.message?.photo || ctx.message?.video || ctx.message?.animation || ctx.message?.document);

  if (blockedCallback || blockedCommand || blockedText || blockedSession || hasMedia) {
    if (ctx.callbackQuery) await safeAnswerCbQuery(ctx);
    if (ctx.reply) await ctx.reply('Bu funksiya o\'chirildi. Kino kodi yuborish funksiyasi tez orada qo\'shiladi.');
    return;
  }
  return next();
});

bot.start(async (ctx) => {
  return handleStart(ctx);
});

bot.action(/^language:(uz|en|ru|ar|tr|zh|ko|tg)$/, async (ctx) => {
  await ctx.answerCbQuery();
  userData(ctx.from.id).language = ctx.match[1];
  saveData();
  reset(ctx);
  return ctx.reply(tr(ctx, 'languageSaved'), mainKeyboard(ctx));
});

bot.command('settings', (ctx) => ctx.reply(tr(ctx, 'welcome'), languageKeyboard()));
bot.command('profile', (ctx) => ctx.reply(buildProfileText(ctx), mainKeyboard(ctx)));
bot.command('premium', (ctx) => ctx.reply(buildPremiumText(ctx), premiumInlineKeyboard()));

bot.action('premium:stats', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply(premiumStatsText(ctx), premiumInlineKeyboard());
});

bot.command('channels', showChannels);

// --- ESKI MA'LUMOTLARNI YUKLAB OLISH BUYRUG'I --

bot.hears(Object.values(text.createPost), showChannels);
bot.hears(Object.values(text.videoSave), (ctx) => {
  ctx.session = { step: 'media_url' };
  return ctx.reply('Ijtimoiy tarmoqdan rasm/video URL yuboring:', Markup.removeKeyboard());
});
bot.hears(Object.values(text.channels), showChannels);
bot.hears(Object.values(text.addChannel), (ctx) => {
  ctx.session = { step: 'channel' };
  ctx.reply('Kanal username sini yuboring, masalan: @my_channel');
});

bot.hears(Object.values(text.settings), (ctx) => ctx.reply(tr(ctx, 'welcome'), languageKeyboard()));

bot.hears('👤 Profilim', (ctx) => {
  return ctx.reply(buildProfileText(ctx), mainKeyboard(ctx));
});

bot.hears('💎 Premium', (ctx) => {
  return ctx.reply(buildPremiumText(ctx), premiumInlineKeyboard());
});

bot.hears('📊 Post statistikasi', (ctx) => {
  return ctx.reply(premiumStatsText(ctx), mainKeyboard(ctx));
});

bot.hears(Object.values(text.admin), (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  return ctx.reply('🛠 Admin panel', adminKeyboard(ctx));
});

bot.action('check_subscription', async (ctx) => {
  await ctx.answerCbQuery();
  if (await requiredSubscription(ctx)) {
    return ctx.reply('✅ Obuna tasdiqlandi. Botdan foydalanishingiz mumkin.', mainKeyboard(ctx));
  }
});

bot.action('admin:user_search', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'admin_user_search' };
  return ctx.reply('Userning botdagi personal ID raqamini yuboring:', adminKeyboard(ctx));
});

bot.action(/^admin:message_user:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const targetId = normalizePersonalId(ctx.match[1]);
  const found = await findUserByPersonalId(targetId);
  if (!found) return ctx.reply('Bunday foydalanuvchi topilmadi.', adminKeyboard(ctx));

  ctx.session = { step: 'admin_user_message', targetKey: found.key, targetPersonalId: targetId };
  return ctx.reply('Foydalanuvchiga yuboriladigan xabarni yozing:', adminKeyboard(ctx));
});

bot.action('premium_paid', async (ctx) => {
  await ctx.answerCbQuery();
  const account = userData(ctx.from.id);
  if (account.premium) {
    return ctx.reply('<tg-emoji emoji-id="5393318303353563978">⚡️</tg-emoji> Siz allaqachon premium tarifga egasiz.', mainKeyboard(ctx));
  }
  ctx.session = { step: 'premium_payment_photo', buyer: ctx.from.id };
  return ctx.reply(`<tg-emoji emoji-id="5422679296789455210">🇺🇿</tg-emoji> To\'lov chekingizni (rasm) yuboring. Admin tekshiruv uchun yetib keladi.`, mainKeyboard(ctx));
});

bot.action(/^admin:premium_approve:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');

  const userId = Number(ctx.match[1]);
  const account = userData(userId);
  account.premium = true;
  saveData();

  try {
    await bot.telegram.sendMessage(userId, `<tg-emoji emoji-id="5393318303353563978">⚡️</tg-emoji> Premium tarif tasdiqlandi. Endi premium imkoniyatlardan foydalanishingiz mumkin.`, {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(ctx).reply_markup
    });
  } catch (error) {
    console.error('Premium approve user message failed:', error?.response?.description || error.message);
  }

  try {
    await bot.telegram.sendMessage(ADMIN_TG_ID, `<tg-emoji emoji-id="5415726114104418638">🔵</tg-emoji> Premium so\'rovi tasdiqlandi. Foydalanuvchi ID: ${userId}`, {
      parse_mode: 'HTML',
      reply_markup: adminKeyboard(ctx).reply_markup
    });
  } catch (error) {
    console.error('Premium approve admin notification failed:', error?.response?.description || error.message);
  }

  return ctx.reply('<tg-emoji emoji-id="5393318303353563978">⚡️</tg-emoji> Premium tarif tasdiqlandi.', adminKeyboard(ctx));
});

bot.action(/^admin:premium_reject:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');

  const userId = Number(ctx.match[1]);
  const account = userData(userId);
  account.premium = false;
  saveData();

  try {
    await bot.telegram.sendMessage(userId, `<tg-emoji emoji-id="5415726114104418638">🔵</tg-emoji> Premium so\'rovi rad etildi. Tekshiruvda muammo mavjud.`, {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard(ctx).reply_markup
    });
  } catch (error) {
    console.error('Premium reject user message failed:', error?.response?.description || error.message);
  }

  try {
    await bot.telegram.sendMessage(ADMIN_TG_ID, `<tg-emoji emoji-id="5415726114104418638">🔵</tg-emoji> Premium so\'rovi rad etildi. Foydalanuvchi ID: ${userId}`, {
      parse_mode: 'HTML',
      reply_markup: adminKeyboard(ctx).reply_markup
    });
  } catch (error) {
    console.error('Premium reject admin notification failed:', error?.response?.description || error.message);
  }

  return ctx.reply('<tg-emoji emoji-id="5415726114104418638">🔵</tg-emoji> Premium so\'rovi rad etildi.', adminKeyboard(ctx));
});

bot.action('admin:stats', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const statistics = await statsText();
  return ctx.reply(statistics[userLanguage(ctx)] || statistics.uz, adminKeyboard(ctx));
});

bot.action('admin:subscription', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'required_subscription_channel' };
  return ctx.reply('Majburiy obuna kanalining public username sini yuboring, masalan: @my_channel');
});

bot.action('admin:required_list', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  return ctx.reply(await formatRequiredChannelList(), adminKeyboard(ctx));
});

bot.action('admin:subscription_off', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  data.settings.requiredChannels = [];
  data.settings.requiredChannel = undefined;
  await BotConfig.findOneAndUpdate(
    { configKey: 'main_config' },
    { $set: { channels: [], 'settings.requiredChannels': [] }, $unset: { 'settings.requiredChannel': 1 } },
    { upsert: true, new: true }
  );
  saveData();
  return ctx.reply('✅ Majburiy obuna o\'chirildi.', adminKeyboard(ctx));
});

bot.action('admin:premium_settings', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'admin_premium_settings_menu' };
  return ctx.reply('💳 Premium to\'lov kartasi va narxini tanlang:', Markup.inlineKeyboard([
    [Markup.button.callback('🪪 Karta raqamini o\'zgartirish', 'admin:premium_card_edit')],
    [Markup.button.callback('💵 Premium narxini o\'zgartirish', 'admin:premium_price_edit')],
    [Markup.button.callback('⬅️ Orqaga', 'admin:back')]
  ]));
});

bot.action('admin:premium_card_edit', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'admin_premium_card_edit' };
  return ctx.reply(`Yangi karta raqamini yuboring (hozirgi: ${String(data.settings?.premiumCardNumber || '9860 0803 9258 5933')})`, adminKeyboard(ctx));
});

bot.action('admin:premium_price_edit', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'admin_premium_price_edit' };
  return ctx.reply(`Yangi premium narxini yuboring (hozirgi: ${Number(data.settings?.premiumPrice || 10000)} so'm)`, adminKeyboard(ctx));
});

bot.action('admin:back', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  reset(ctx);
  return ctx.reply('🛠 Admin panel', adminKeyboard(ctx));
});

bot.action('admin:broadcast', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'broadcast_photo', post: { buttons: [] }, broadcast: true };
  return ctx.reply('Broadcast uchun rasm, video, GIF yoki hujjat yuboring yoki «Rasmsiz» tugmasini bosing.', Markup.inlineKeyboard([
    [Markup.button.callback('Rasmsiz', 'broadcast_no_photo')],
    [Markup.button.callback('Bekor qilish', 'cancel')]
  ]));
});

bot.action('broadcast_no_photo', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session?.broadcast) return ctx.reply('Broadcast boshlanmagan.');
  ctx.session.step = 'broadcast_caption';
  return ctx.reply('Broadcast izohini yuboring:');
});

bot.action('channels', async (ctx) => {
  await ctx.answerCbQuery();
  return showChannels(ctx);
});

bot.action('add_channel', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session = { step: 'channel' };
  return ctx.reply('Kanal username sini yuboring, masalan: @my_channel');
});

bot.action('compose_multi', async (ctx) => {
  await ctx.answerCbQuery();
  const account = userData(ctx.from.id);
  if (!account.premium) return ctx.reply('Bu funksiya Premium foydalanuvchilar uchun mavjud.', mainKeyboard(ctx));
  if (account.channels.length < 2) return ctx.reply('Bir nechta kanalga yuborish uchun kamida 2 ta kanal qo\'shing.', mainKeyboard(ctx));
  ctx.session = { step: 'multi_channel_select', selectedChannels: [] };
  return ctx.reply('Post yuboriladigan kanallarni tanlang:', multiChannelKeyboard(ctx, account.channels));
});

bot.action(/^multi_channel:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session || ctx.session.step !== 'multi_channel_select') return ctx.reply('Post yaratishni qaytadan boshlang.');
  const account = userData(ctx.from.id);
  const channel = account.channels.find((item) => String(item.id) === ctx.match[1]);
  if (!channel) return ctx.reply('Kanal topilmadi.');
  const selected = new Set((ctx.session.selectedChannels || []).map((id) => String(id)));
  if (selected.has(String(channel.id))) selected.delete(String(channel.id));
  else selected.add(String(channel.id));
  ctx.session.selectedChannels = [...selected];
  return ctx.editMessageReplyMarkup(multiChannelKeyboard(ctx, account.channels, ctx.session.selectedChannels).reply_markup);
});

bot.action('multi_channels_done', async (ctx) => {
  await ctx.answerCbQuery();
  const selectedIds = ctx.session?.selectedChannels || [];
  if (!selectedIds.length) return ctx.reply('Kamida bitta kanalni tanlang.');
  const channels = userData(ctx.from.id).channels.filter((channel) => selectedIds.includes(String(channel.id)));
  ctx.session = { step: 'photo', selectedChannels: channels, post: { buttons: [] } };
  return ctx.reply('Post uchun rasm, video, GIF yoki hujjat yuboring yoki «Rasmsiz» tugmasini bosing.', Markup.inlineKeyboard([
    [Markup.button.callback('Rasmsiz', 'no_photo')],
    [Markup.button.callback('Bekor qilish', 'cancel')]
  ]));
});

bot.action(/^channel:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const channel = userData(ctx.from.id).channels.find((item) => String(item.id) === ctx.match[1]);
  if (!channel) return ctx.reply('Kanal topilmadi.');
  ctx.session ||= {};
  ctx.session.selectedChannel = channel;
  return ctx.reply(`${channel.title} (${channel.username})`, channelActions(ctx, channel.id));
});



bot.action(/^remove:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const account = userData(ctx.from.id);
  account.channels = account.channels.filter((item) => String(item.id) !== ctx.match[1]);
  saveData();
  return ctx.reply('Kanal ro\'yxatdan o\'chirildi.', mainKeyboard(ctx));
});

bot.action(/^compose:(-?\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const channel = userData(ctx.from.id).channels.find((item) => String(item.id) === ctx.match[1]);
  if (!channel) return ctx.reply('Kanal topilmadi.');
  ctx.session = { step: 'photo', selectedChannels: [channel], post: { buttons: [] } };
  return ctx.reply('Post uchun rasm, video, GIF yoki hujjat yuboring yoki «Rasmsiz» tugmasini bosing.', Markup.inlineKeyboard([
    [Markup.button.callback('Rasmsiz', 'no_photo')],
    [Markup.button.callback('Bekor qilish', 'cancel')]
  ]));
});

function saveComposerMedia(ctx, mediaType, mediaId, message) {
  if (!ctx.session || !['photo', 'broadcast_photo'].includes(ctx.session.step)) return null;
  ctx.session.post.mediaType = mediaType;
  ctx.session.post.media = mediaId;
  if (mediaType === 'photo') ctx.session.post.photo = mediaId;

  if (ctx.session.broadcast && message.caption !== undefined) {
    ctx.session.post.caption = message.caption;
    ctx.session.post.captionEntities = message.caption_entities || [];
    ctx.session.step = 'buttons';
    return ctx.reply('Media va izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:', composerKeyboard(ctx));
  }
  if (ctx.session.broadcast) {
    ctx.session.step = 'broadcast_caption';
    return ctx.reply('Media saqlandi. Broadcast izohini yuboring:');
  }
  if (message.caption !== undefined) {
    ctx.session.post.caption = message.caption;
    ctx.session.post.captionEntities = message.caption_entities || [];
    ctx.session.step = 'buttons';
    return ctx.reply('Media va izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:', composerKeyboard(ctx));
  }
  ctx.session.step = 'caption';
  return ctx.reply('Endi post izohini yuboring yoki «Izohsiz» tugmasini bosing.', Markup.inlineKeyboard([
    [Markup.button.callback('Izohsiz', 'no_caption')],
    [Markup.button.callback('Bekor qilish', 'cancel')]
  ]));
}

bot.on('photo', async (ctx) => {
  if (ctx.session?.step === 'premium_payment_photo') {
    const photoFileId = ctx.message.photo.at(-1).file_id;
    const requester = ctx.from;
    const user = userData(requester.id);
    const cardText = `<tg-emoji emoji-id="5415726114104418638">🔵</tg-emoji> Premium so'rovi\n\n` +
      `Foydalanuvchi: ${requester.username || requester.first_name || requester.id}\n` +
      `Telegram ID: ${requester.id}\n` +
      `Bot personal ID: ${user.personalId || '—'}\n\n` +
      `To'lov cheki rasm yuborildi.`;
    await bot.telegram.sendPhoto(ADMIN_TG_ID, photoFileId, {
      caption: cardText,
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [Markup.button.callback('✅ Premium berish', `admin:premium_approve:${requester.id}`)],
        [Markup.button.callback('❌ Premium bermaslik', `admin:premium_reject:${requester.id}`)]
      ]).reply_markup
    });
    reset(ctx);
    return ctx.reply(`<tg-emoji emoji-id="5321210956414459578">✔️</tg-emoji> To\'lov chekingiz adminga yuborildi. Tasdiq kutilmoqda.`, mainKeyboard(ctx));
  }

  const message = ctx.message;
  return saveComposerMedia(ctx, 'photo', message.photo.at(-1).file_id, message);
});

bot.on('video', (ctx) => saveComposerMedia(ctx, 'video', ctx.message.video.file_id, ctx.message));
bot.on('animation', (ctx) => saveComposerMedia(ctx, 'animation', ctx.message.animation.file_id, ctx.message));
bot.on('document', (ctx) => saveComposerMedia(ctx, 'document', ctx.message.document.file_id, ctx.message));

bot.action('no_photo', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.step = 'caption';
  return ctx.reply('Endi post izohini yuboring yoki «Izohsiz» tugmasini bosing.', Markup.inlineKeyboard([
    [Markup.button.callback('Izohsiz', 'no_caption')],
    [Markup.button.callback('Bekor qilish', 'cancel')]
  ]));
});

bot.action('no_caption', async (ctx) => {
  await ctx.answerCbQuery();
  if (!ctx.session.post) return ctx.reply('Avval post yaratishni boshlang.');
  ctx.session.post.caption = '';
  ctx.session.post.captionEntities = [];
  ctx.session.step = 'buttons';
  return ctx.reply('Post tayyor. Havolali tugmalar qo\'shishingiz mumkin:', composerKeyboard(ctx));
});

bot.action('add_button', async (ctx) => {
  await ctx.answerCbQuery();
  ctx.session.step = 'button_text';
  return ctx.reply('Tugma matnini yuboring:');
});

bot.action('save_template', async (ctx) => {
  await ctx.answerCbQuery();
  const post = ctx.session?.post;
  if (!postHasContent(post)) return ctx.reply('Avval post mazmunini kiriting.');
  const account = userData(ctx.from.id);
  if (!account.premium) return ctx.reply('Shablon saqlash Premium foydalanuvchilar uchun mavjud.', mainKeyboard(ctx));
  account.templates ||= [];
  account.templates.push({
    id: Date.now(),
    name: `Shablon ${account.templates.length + 1}`,
    post: JSON.parse(JSON.stringify(post)),
    createdAt: new Date()
  });
  account.templates = account.templates.slice(-20);
  saveData();
  return ctx.reply('✅ Post shablon sifatida saqlandi', composerKeyboard(ctx));
});

bot.action('templates', async (ctx) => {
  await ctx.answerCbQuery();
  const account = userData(ctx.from.id);
  if (!account.premium) return ctx.reply('Shablonlar Premium foydalanuvchilar uchun mavjud.', mainKeyboard(ctx));
  if (!account.templates?.length) return ctx.reply('Saqlangan shablonlar yo\'q.', composerKeyboard(ctx));
  return ctx.reply('Shablonni tanlang:', templateKeyboard(account.templates));
});

bot.action(/^template:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const template = userData(ctx.from.id).templates?.find((item) => String(item.id) === ctx.match[1]);
  if (!template) return ctx.reply('Shablon topilmadi.', composerKeyboard(ctx));
  ctx.session.post = JSON.parse(JSON.stringify(template.post));
  ctx.session.step = 'buttons';
  return ctx.reply('Shablon yuklandi. Uni ko\'rib chiqing yoki o\'zgartiring:', composerKeyboard(ctx));
});

bot.action('templates_back', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.reply('Post sozlamalari:', composerKeyboard(ctx));
});

bot.action(/^button_color:(blue|green|red)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const sessionState = ctx.session || {};
  if (!sessionState.post || !sessionState.pendingButtonText || !sessionState.pendingButtonUrl) {
    return ctx.reply('Tugma ma\'lumotlari topilmadi. Qaytadan boshlang.');
  }
  sessionState.pendingButtonColor = {
    blue: 'primary',
    green: 'success',
    red: 'danger'
  }[ctx.match[1]];
  return ctx.reply('Tugma qatorini tanlang:', buttonPlacementKeyboard(ctx));
});

bot.action(/^button_place:(new|same)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const sessionState = ctx.session || {};
  if (!sessionState.post || !sessionState.pendingButtonText || !sessionState.pendingButtonUrl || !sessionState.pendingButtonColor) {
    return ctx.reply('Tugma ma\'lumotlari topilmadi. Qaytadan boshlang.');
  }

  sessionState.post.buttons ||= [];
  const button = {
    text: sessionState.pendingButtonText,
    url: sessionState.pendingButtonUrl,
    style: sessionState.pendingButtonColor
  };
  if (ctx.match[1] === 'same' && sessionState.post.buttons.length) {
    sessionState.post.buttons.at(-1).push(button);
  } else {
    sessionState.post.buttons.push([button]);
  }
  sessionState.pendingButtonText = undefined;
  sessionState.pendingButtonUrl = undefined;
  sessionState.pendingButtonColor = undefined;
  sessionState.step = 'buttons';
  return ctx.reply('Tugma qo\'shildi. Yana tugma qo\'shasizmi yoki postni yuboramizmi?', composerKeyboard(ctx));
});

bot.action('preview', async (ctx) => {
  await ctx.answerCbQuery();
  return sendPreview(ctx);
});

bot.action('publish', async (ctx) => {
  await ctx.answerCbQuery();
  const { selectedChannel, selectedChannels, post } = ctx.session;
  if (ctx.session.broadcast) {
    if (!postHasContent(post)) return ctx.reply('Broadcast mazmuni topilmadi.');
    const sent = await broadcastPost(ctx, { ...post, finalButtons: ctx.session.previewButtons });
    reset(ctx);
    return ctx.reply(`✅ Broadcast ${sent} ta chatga yuborildi.`, mainKeyboard(ctx));
  }
  const channels = selectedChannels?.length ? selectedChannels : selectedChannel ? [selectedChannel] : [];
  if (!channels.length || !postHasContent(post)) return ctx.reply('Post ma\'lumotlari topilmadi.');

  const chargeResult = await chargeForPostIfNeeded(ctx);
  if (!chargeResult.ok) return ctx.reply(chargeResult.message, mainKeyboard(ctx));

  const buttons = ctx.session.previewButtons || postButtons(post);
  const replyMarkup = Markup.inlineKeyboard(buttons).reply_markup;
  const results = await Promise.allSettled(
    channels.map((channel) => sendPostToChat(ctx, channel.id, post, replyMarkup))
  );
  const sentChannels = channels.filter((channel, index) => results[index].status === 'fulfilled');
  for (const result of results.filter((item) => item.status === 'rejected')) {
    console.error('Post send failed:', result.reason?.response?.description || result.reason?.message);
  }
  if (!sentChannels.length) {
    return ctx.reply('❌ Postni hech qaysi kanalga yuborib bo\'lmadi. Kanal ruxsatlarini tekshiring.', mainKeyboard(ctx));
  }
  const account = userData(ctx.from.id);
  const publishedAt = new Date();
  const statEntry = {
    publishedAt,
    channelIds: sentChannels.map((channel) => channel.id),
    channelCount: sentChannels.length,
    mediaType: post.mediaType || (post.photo ? 'photo' : 'text')
  };
  const updatedAccount = await User.findOneAndUpdate(
    { telegramId: Number(ctx.from.id) },
    {
      $inc: { publishedPosts: 1, publishedChannels: sentChannels.length },
      $set: { lastPublishedAt: publishedAt },
      $push: { postStats: { $each: [statEntry], $slice: -100 } }
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  ).lean();
  data.users[String(ctx.from.id)] = accountFromMongo(updatedAccount);
  data.stats.postsSent += sentChannels.length;
  await saveData();
  reset(ctx);
  return ctx.reply(`✅ Post ${sentChannels.length} ta kanalga muvaffaqiyatli yuborildi.`, mainKeyboard(ctx));
});

bot.action('cancel', async (ctx) => {
  await ctx.answerCbQuery();
  reset(ctx);
  return ctx.reply(`${CANCEL_EMOJI_TAG} Amal bekor qilindi`, mainKeyboard(ctx));
});

bot.on('text', async (ctx) => {
  const sessionState = ctx.session || {};
  const text = ctx.message.text;
  const trimmedText = text.trim();

  if (sessionState.step === 'media_url') {
    if (!isUrl(trimmedText)) return ctx.reply('Havola http:// yoki https:// bilan boshlanishi kerak. Qayta yuboring:');
    sessionState.step = null;
    return sendMediaFromUrl(ctx, trimmedText);
  }

  if (sessionState.step === 'admin_premium_card_edit') {
    if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
    const cardNumber = trimmedText.replace(/\s+/g, ' ').trim();
    if (!/^\d{4}(\s\d{4}){3}$/.test(cardNumber)) {
      return ctx.reply('❌ Karta raqami noto\'g\'ri formatda. Masalan: 9860 0803 9258 5933', adminKeyboard(ctx));
    }
    data.settings.premiumCardNumber = cardNumber;
    saveData();
    reset(ctx);
    return ctx.reply(`✅ Premium karta raqami yangilandi: ${cardNumber}`, adminKeyboard(ctx));
  }

  if (sessionState.step === 'admin_premium_price_edit') {
    if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
    const price = Number(trimmedText.replace(/\D/g, ''));
    if (!Number.isFinite(price) || price <= 0) {
      return ctx.reply('❌ Premium narxini faqat musbat son ko\'rinishida kiriting.', adminKeyboard(ctx));
    }
    data.settings.premiumPrice = price;
    saveData();
    reset(ctx);
    return ctx.reply(`✅ Premium narxi yangilandi: ${price} so'm`, adminKeyboard(ctx));
  }

  if (sessionState.step === 'required_subscription_channel') {
    if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
    try {
      const channel = await checkRequiredSubscriptionChannel(ctx, normalizeChannel(trimmedText));
      data.settings.requiredChannels ||= [];
      if (!data.settings.requiredChannels.some((item) => item.id === channel.id)) {
        data.settings.requiredChannels.push(channel);
      }
      data.settings.requiredChannel = channel;
      await BotConfig.findOneAndUpdate(
        { configKey: 'main_config' },
        { $set: { channels: data.settings.requiredChannels, 'settings.requiredChannels': data.settings.requiredChannels, 'settings.requiredChannel': channel } },
        { upsert: true, new: true }
      );
      saveData();
      reset(ctx);
      return ctx.reply(`✅ ${channel.title} majburiy obuna kanali qilib sozlandi.`, adminKeyboard(ctx));
    } catch (error) {
      return ctx.reply(`❌ ${error.message}`);
    }
  }

  if (sessionState.step === 'channel') {
    try {
      const channel = await checkFullAdmin(ctx, normalizeChannel(trimmedText));
      const account = userData(ctx.from.id);
      if (!account.premium && account.channels.length >= 1) {
        return ctx.reply(`<tg-emoji emoji-id="5084974483685507801">💜</tg-emoji> ${tr(ctx, 'Limit tugadi. Premium ta`rifni sotib oling!')}`, { parse_mode: 'HTML', reply_markup: mainKeyboard(ctx) });
      }
      if (!account.channels.some((item) => item.id === channel.id)) account.channels.push(channel);
      saveData();
      reset(ctx);
      return ctx.reply(`✅ ${channel.title} kanal ro\'yxatingizga qo\'shildi.`, mainKeyboard(ctx));
    } catch (error) {
      return ctx.reply(`❌ ${error.message}\n\nUsername ni to\'g\'ri yuboring va botga barcha admin huquqlarini bering.`);
    }
  }

  if (sessionState.step === 'caption') {
    sessionState.post.caption = text;
    sessionState.post.captionEntities = ctx.message.entities || [];
    sessionState.step = 'buttons';
    return ctx.reply('Izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:', composerKeyboard(ctx));
  }

  if (sessionState.step === 'broadcast_caption') {
    sessionState.post.caption = text;
    sessionState.post.captionEntities = ctx.message.entities || [];
    sessionState.step = 'buttons';
    return ctx.reply('Izoh saqlandi. Havolali tugmalar qo\'shishingiz mumkin:', composerKeyboard(ctx));
  }

  if (sessionState.step === 'button_text') {
    sessionState.pendingButtonText = text;
    sessionState.step = 'button_url';
    return ctx.reply('Endi tugma havolasini yuboring (https://...):');
  }

  if (sessionState.step === 'button_url') {
    if (!isUrl(trimmedText)) return ctx.reply('Havola http:// yoki http]s:// bilan boshlanishi kerak. Qayta yuboring:');
    sessionState.pendingButtonUrl = trimmedText;
    sessionState.step = 'button_color';
    return ctx.reply('Tugma rangini tanlang:', buttonColorKeyboard(ctx));
  }

  if (sessionState.step === 'admin_user_search') {
    if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
    const target = normalizePersonalId(trimmedText);
    const found = await findUserByPersonalId(target);
    if (!found) return ctx.reply('Bunday foydalanuvchi topilmadi.', adminKeyboard(ctx));
    const account = found.account;
    const detail = `👤 User ma\'lumotlari\n\n` +
      `Username: ${account.username || '—'}\n` +
      `Nickname: ${account.nickname || '—'}\n` +
      `Bot personal ID: ${account.personalId || '—'}\n` +
      `Telegram ID: ${found.key}\n` +
      `Premium status: ${account.premium ? 'Premium mavjud' : 'Premium yo\'q'}`;
    ctx.session = { step: 'admin_user_search_result', targetKey: found.key, targetPersonalId: account.personalId };
    return ctx.reply(detail, adminUserSearchResultKeyboard(account.personalId));
  }

  if (sessionState.step === 'admin_user_message') {
    if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
    const targetChat = Number(sessionState.targetKey);
    if (!Number.isFinite(targetChat)) return ctx.reply('Foydalanuvchi topilmadi.', adminKeyboard(ctx));

    try {
      await bot.telegram.sendMessage(targetChat, trimmedText, {
        entities: Array.isArray(ctx.message.entities) ? ctx.message.entities : undefined
      });
      reset(ctx);
      return ctx.reply('✅ Xabar foydalanuvchiga yuborildi.', adminKeyboard(ctx));
    } catch (error) {
      console.error('Admin user direct message failed:', error.response?.description || error.message);
      reset(ctx);
      return ctx.reply('❌ Xabar yuborishda xatolik yuz berdi. Foydalanuvchi botga start bosgan yoki chatni ochgan bo\'lishi kerak.', adminKeyboard(ctx));
    }
  }

  return ctx.reply('Kerakli amalni pastki menyudan tanlang.', mainKeyboard(ctx));
});

bot.catch((error, ctx) => {
  console.error(`Update ${ctx.updateType} failed:`, error.response?.description || error.message);
  safeAnswerCbQuery(ctx);
  if (ctx?.reply) {
    ctx.reply('Texnik xatolik yuz berdi. Keyinroq qayta urinib ko\'ring.').catch(() => {});
  }
});

async function setupBotAbout() {
  try {
    const aboutText = `🇺🇿 Kino kodi orqali video yuboruvchi bot. <tg-emoji emoji-id="50849744836855078101">💜</tg-emoji>\n🇷🇺 Бот отправки фильмов по коду. <tg-emoji emoji-id="5285430309720966085">🔥</tg-emoji>\nAdmin: ${ADMIN_PUBLIC_USERNAME}`;
    await bot.telegram.setMyShortDescription(aboutText);
    console.log("🚀 Botning 'About' qismi premium emojilar bilan muvaffaqiyatli yangilandi!");
  } catch (error) {
    console.error("❌ About qismini yangilashda xatolik yuz berdi:", error.message);
  }
}

async function startBot() {
  await hydrateFromMongo();
  await bot.launch();
  try {
    console.log('Bot ishga tushdi.');
    await setupBotAbout();
  } catch (error) {
    console.error('Bot setup failed:', error);
  }
}

startBot().catch((error) => {
  console.error('Bot startup failed:', error);
  process.exitCode = 1;
});

process.once('SIGINT', async () => {
  bot.stop('SIGINT');
  await mongoose.disconnect();
});
process.once('SIGTERM', async () => {
  bot.stop('SIGTERM');
  await mongoose.disconnect();
});