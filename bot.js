require('dotenv').config();
const config = require('./config');
process.env.TZ = config.timezone;

const mongoose = require('mongoose');
const express = require('express');
const { Telegraf, Markup, session } = require('telegraf');

const mongoConnection = mongoose.connect(config.mongoUri, {
  serverSelectionTimeoutMS: 10000
});

const userSchema = new mongoose.Schema({
  telegramId: { type: Number, unique: true, required: true, index: true },
  username: { type: String, default: '' },
  nickname: { type: String, default: '' },
  joinedAt: { type: Date, default: Date.now }
}, { versionKey: false });

const movieSchema = new mongoose.Schema({
  code: { type: String, unique: true, required: true, index: true },
  title: { type: String, required: true },
  genre: { type: String, required: true },
  language: { type: String, required: true },
  videoFileId: { type: String, required: true },
  promoFileId: { type: String, required: true },
  promoType: { type: String, enum: ['photo', 'video'], required: true },
  views: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const botConfigSchema = new mongoose.Schema({
  configKey: { type: String, default: 'main_config', unique: true },
  channels: { type: Array, default: [] },
  settings: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { versionKey: false });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Movie = mongoose.models.Movie || mongoose.model('Movie', movieSchema);
const BotConfig = mongoose.models.BotConfig || mongoose.model('BotConfig', botConfigSchema);

const app = express();
const port = Number(process.env.PORT) || 3000;
app.get('/', (req, res) => res.send('Movie bot ishlamoqda...'));
app.get('/health', (req, res) => res.status(200).json({
  ok: true,
  mongodb: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
}));
app.listen(port, '0.0.0.0', () => console.log(`Express server ${port} portda ishlayapti.`));

const bot = new Telegraf(config.botToken);
const ADMIN_USERNAME = config.admin.username;
const data = { settings: { requiredChannels: [], movieChannel: null } };

function isAdmin(ctx) {
  return ctx.from?.username?.toLowerCase() === ADMIN_USERNAME;
}

function reset(ctx) {
  ctx.session = {};
}

function normalizeChannel(value) {
  const trimmed = String(value || '').trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function adminKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Statistika', 'admin:stats')],
    [Markup.button.callback('Kino joylash', 'admin:add_movie')],
    [Markup.button.callback('Kino reklama kanalini sozlash', 'admin:movie_channel')],
    [Markup.button.callback('Kino kodini qidirish', 'admin:find_movie')],
    [Markup.button.callback('Majburiy obuna kanalini qo\'shish', 'admin:subscription')],
    [Markup.button.callback('Majburiy obuna kanallari', 'admin:required_list')],
    [Markup.button.callback('Majburiy obunani o\'chirish', 'admin:subscription_off')]
  ]);
}

function userKeyboard(ctx) {
  return isAdmin(ctx) ? Markup.keyboard([['Admin panel']]).resize() : Markup.removeKeyboard();
}

function welcomeMessage(ctx) {
  const nickname = ctx.from?.first_name || ctx.from?.username || 'foydalanuvchi';
  return `Assalomu alaykum ${nickname}\n\n` +
    `@${config.botUsername} orqali siz o'zingizga yoqqan kinoni topishingiz mumkin\n` +
    `Shunchaki kino kodini yuboring va kinoni oling`;
}

function welcomeMarkup() {
  const channel = data.settings.movieChannel;
  if (!channel?.username) return undefined;
  return Markup.inlineKeyboard([[
    Markup.button.url('Kino kodlari kanali', `https://t.me/${String(channel.username).replace(/^@/, '')}`)
  ]]).reply_markup;
}

function subscriptionKeyboard(channels) {
  const rows = channels.map((channel, index) => [Markup.button.url(
    `${index + 1} - kanal`,
    `https://t.me/${String(channel.username).replace(/^@/, '')}`
  )]);
  rows.push([Markup.button.callback('Tekshirish', 'check_subscription')]);
  return Markup.inlineKeyboard(rows);
}

async function getRequiredChannels() {
  const configDocument = await BotConfig.findOne({ configKey: 'main_config' }, { channels: 1 }).lean();
  return configDocument?.channels || data.settings.requiredChannels || [];
}

async function requiredSubscription(ctx) {
  if (isAdmin(ctx)) return true;
  const channels = await getRequiredChannels();
  if (!channels.length) return true;

  const notSubscribed = [];
  for (const channel of channels) {
    try {
      const member = await ctx.telegram.getChatMember(channel.id, ctx.from.id);
      if (!['creator', 'administrator', 'member'].includes(member.status)) notSubscribed.push(channel);
    } catch (error) {
      console.error('Subscription check failed:', error.response?.description || error.message);
      notSubscribed.push(channel);
    }
  }

  if (!notSubscribed.length) return true;
  await ctx.reply('Botdan foydalanish uchun quyidagi kanallarga obuna bo\'ling', subscriptionKeyboard(notSubscribed));
  return false;
}

async function checkFullAdmin(ctx, username) {
  const chat = await ctx.telegram.getChat(username);
  if (chat.type !== 'channel') throw new Error('Bu username kanalga tegishli emas.');

  const userMember = await ctx.telegram.getChatMember(chat.id, ctx.from.id);
  if (!['creator', 'administrator'].includes(userMember.status)) {
    throw new Error('Kanalni qo\'shish uchun kanalda admin yoki ega bo\'lishingiz kerak.');
  }
  const botInfo = await ctx.telegram.getMe();
  const member = await ctx.telegram.getChatMember(chat.id, botInfo.id);
  if (!['creator', 'administrator'].includes(member.status)) {
    throw new Error('Bot kanalida administrator bo\'lishi kerak.');
  }
  if (member.status === 'administrator' && member.can_post_messages === false) {
    throw new Error('Botga kanalda post yuborish huquqini bering.');
  }
  return { id: chat.id, title: chat.title || username, username: chat.username ? `@${chat.username}` : username };
}

async function saveSettings() {
  await BotConfig.findOneAndUpdate(
    { configKey: 'main_config' },
    { $set: { channels: data.settings.requiredChannels, settings: { movieChannel: data.settings.movieChannel } } },
    { upsert: true }
  );
}

async function hydrateSettings() {
  await mongoConnection;
  let configDocument = await BotConfig.findOne({ configKey: 'main_config' }).lean();
  if (!configDocument) {
    configDocument = await BotConfig.create({ configKey: 'main_config', channels: [], settings: {} });
    configDocument = configDocument.toObject();
  }
  data.settings.requiredChannels = configDocument.channels || [];
  data.settings.movieChannel = configDocument.settings?.movieChannel || null;
}

async function ensureUser(ctx) {
  const telegramId = Number(ctx.from.id);
  return User.findOneAndUpdate(
    { telegramId },
    { $set: { username: ctx.from.username || '', nickname: ctx.from.first_name || ctx.from.last_name || '' }, $setOnInsert: { telegramId, joinedAt: new Date() } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  ).lean();
}

function movieCaption(movie, views, includeViews = true) {
  const viewsLine = includeViews ? `Ko'rilgan: ${views} marta\n` : '';
  return `<b>${movie.title}</b>\n\n` +
    `Kino kodi: <code>${movie.code}</code>\n` +
    `Janri: ${movie.genre}\n` +
    `Tili: ${movie.language}\n` +
    viewsLine +
    `Bot: @${config.botUsername}`;
}

function movieLink(code) {
  return `https://t.me/${config.botUsername}?start=movie_${encodeURIComponent(code)}`;
}

async function sendMovie(ctx, code) {
  const normalizedCode = String(code || '').trim();
  const movie = await Movie.findOneAndUpdate(
    { code: normalizedCode },
    { $inc: { views: 1 } },
    { returnDocument: 'after' }
  ).lean();
  if (!movie) return ctx.reply('Kino kodi xato. Boshqa kino kodini yuboring.');
  const channel = data.settings.movieChannel;
  const buttonRows = channel?.username
    ? [[Markup.button.url('Kino kodlari kanali', `https://t.me/${String(channel.username).replace(/^@/, '')}`)]]
    : [];
  return ctx.telegram.sendVideo(ctx.from.id, movie.videoFileId, {
    caption: movieCaption(movie, movie.views),
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard(buttonRows).reply_markup
  });
}

async function sendMovieAdvertisement(movie) {
  const channel = data.settings.movieChannel;
  const extra = {
    caption: movieCaption(movie, 0, false),
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard([[Markup.button.url('Kinoni ko\'rish', movieLink(movie.code))]]).reply_markup
  };
  if (movie.promoType === 'photo') return bot.telegram.sendPhoto(channel.id, movie.promoFileId, extra);
  return bot.telegram.sendVideo(channel.id, movie.promoFileId, extra);
}

async function adminStats(ctx) {
  const [subscribers, movies, views] = await Promise.all([
    User.countDocuments(),
    Movie.countDocuments(),
    Movie.aggregate([{ $group: { _id: null, total: { $sum: '$views' } } }])
  ]);
  return ctx.reply(`Bot statistikasi\n\nObunachilar: ${subscribers}\nJoylangan kinolar: ${movies}\nUmumiy ko'rilgan kinolar: ${views[0]?.total || 0}`, adminKeyboard());
}

function movieAdminKeyboard(code) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Ma\'lumotlarni o\'zgartirish', `admin:edit_movie:${code}`)],
    [Markup.button.callback('Kinoni o\'chirish', `admin:delete_movie:${code}`)],
    [Markup.button.callback('Admin panel', 'admin:panel')]
  ]);
}

function movieAdminText(movie) {
  return `${movie.title}\n\n` +
    `Kino kodi: ${movie.code}\n` +
    `Janri: ${movie.genre}\n` +
    `Tili: ${movie.language}\n` +
    `Ko'rilgan: ${movie.views || 0} marta`;
}

function movieEditKeyboard(code) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('Nomini o\'zgartirish', `admin:edit_field:title:${code}`)],
    [Markup.button.callback('Kodini o\'zgartirish', `admin:edit_field:code:${code}`)],
    [Markup.button.callback('Janrini o\'zgartirish', `admin:edit_field:genre:${code}`)],
    [Markup.button.callback('Tilini o\'zgartirish', `admin:edit_field:language:${code}`)],
    [Markup.button.callback('Videosini o\'zgartirish', `admin:edit_field:video:${code}`)],
    [Markup.button.callback('Reklama mediasini o\'zgartirish', `admin:edit_field:promo:${code}`)],
    [Markup.button.callback('Orqaga', `admin:movie:${code}`)]
  ]);
}

async function handleStart(ctx) {
  await ensureUser(ctx);
  if (!(await requiredSubscription(ctx))) return;
  const payload = ctx.startPayload || '';
  if (payload.startsWith('movie_')) return sendMovie(ctx, payload.slice(6));
  return ctx.reply(welcomeMessage(ctx), { reply_markup: welcomeMarkup() || userKeyboard(ctx).reply_markup });
}

bot.use(session());
bot.start(handleStart);

bot.use(async (ctx, next) => {
  if (ctx.from && ctx.message?.text !== '/start') await ensureUser(ctx);
  if (ctx.callbackQuery?.data === 'check_subscription') return next();
  if (isAdmin(ctx)) return next();
  if (await requiredSubscription(ctx)) return next();
});

bot.action('check_subscription', async (ctx) => {
  await ctx.answerCbQuery();
  if (await requiredSubscription(ctx)) return ctx.reply(welcomeMessage(ctx), { reply_markup: welcomeMarkup() || userKeyboard(ctx).reply_markup });
});

bot.hears('Admin panel', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  return ctx.reply('Admin panel', adminKeyboard());
});

bot.action('admin:stats', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  return adminStats(ctx);
});

bot.action('admin:panel', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  reset(ctx);
  return ctx.reply('Admin panel', adminKeyboard());
});

bot.action('admin:find_movie', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'find_movie' };
  return ctx.reply('Tahrirlash yoki o\'chirish uchun kino kodini yuboring:');
});

bot.action(/^admin:movie:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const movie = await Movie.findOne({ code: ctx.match[1] }).lean();
  if (!movie) return ctx.reply('Kino topilmadi.', adminKeyboard());
  return ctx.reply(movieAdminText(movie), movieAdminKeyboard(movie.code));
});

bot.action(/^admin:edit_movie:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const movie = await Movie.findOne({ code: ctx.match[1] }).lean();
  if (!movie) return ctx.reply('Kino topilmadi.', adminKeyboard());
  return ctx.reply('Qaysi ma\'lumotni o\'zgartirasiz?', movieEditKeyboard(movie.code));
});

bot.action(/^admin:edit_field:(title|code|genre|language|video|promo):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const [, field, code] = ctx.match;
  if (!await Movie.exists({ code })) return ctx.reply('Kino topilmadi.', adminKeyboard());
  ctx.session = { step: `edit_movie_${field}`, movieCode: code };
  const prompts = {
    title: 'Yangi kino nomini yuboring:',
    code: 'Yangi kino kodini yuboring:',
    genre: 'Yangi kino janrini yuboring:',
    language: 'Yangi kino tilini yuboring:',
    video: 'Yangi kino videosini yuboring:',
    promo: 'Yangi reklama videosi yoki rasmini yuboring:'
  };
  return ctx.reply(prompts[field]);
});

bot.action(/^admin:delete_movie:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const movie = await Movie.findOne({ code: ctx.match[1] }).lean();
  if (!movie) return ctx.reply('Kino topilmadi.', adminKeyboard());
  return ctx.reply(`${movie.title} filmini o\'chirishni tasdiqlaysizmi?`, Markup.inlineKeyboard([
    [Markup.button.callback('Ha, o\'chirish', `admin:delete_confirm:${movie.code}`)],
    [Markup.button.callback('Bekor qilish', `admin:movie:${movie.code}`)]
  ]));
});

bot.action(/^admin:delete_confirm:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  const result = await Movie.deleteOne({ code: ctx.match[1] });
  reset(ctx);
  return ctx.reply(result.deletedCount ? 'Kino o\'chirildi.' : 'Kino topilmadi.', adminKeyboard());
});

bot.action('admin:movie_channel', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  ctx.session = { step: 'movie_channel' };
  return ctx.reply('Kino reklamasi tashlanadigan kanal username sini yuboring, masalan: @kino_kanal');
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
  const channels = await getRequiredChannels();
  if (!channels.length) return ctx.reply('Majburiy obuna kanallari yo\'q.', adminKeyboard());
  return ctx.reply(channels.map((channel, index) => `${index + 1} - kanal: ${channel.title || channel.username}`).join('\n'), adminKeyboard());
});

bot.action('admin:subscription_off', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  data.settings.requiredChannels = [];
  await saveSettings();
  return ctx.reply('Majburiy obuna o\'chirildi.', adminKeyboard());
});

bot.action('admin:add_movie', async (ctx) => {
  await ctx.answerCbQuery();
  if (!isAdmin(ctx)) return ctx.reply('Ruxsat yo\'q.');
  if (!data.settings.movieChannel) return ctx.reply('Avval kino reklama kanalini qo\'shing va botni unga admin qiling.', adminKeyboard());
  ctx.session = { step: 'movie_title' };
  return ctx.reply('Kino nomini yuboring:');
});

bot.on('video', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('Kino kodini yuboring.');
  if (ctx.session?.step === 'edit_movie_video') {
    const movie = await Movie.findOneAndUpdate(
      { code: ctx.session.movieCode },
      { $set: { videoFileId: ctx.message.video.file_id } },
      { returnDocument: 'after' }
    ).lean();
    reset(ctx);
    return ctx.reply(movie ? 'Kino videosi yangilandi.' : 'Kino topilmadi.', movie ? movieAdminKeyboard(movie.code) : adminKeyboard());
  }
  if (ctx.session?.step === 'edit_movie_promo') {
    const movie = await Movie.findOneAndUpdate(
      { code: ctx.session.movieCode },
      { $set: { promoFileId: ctx.message.video.file_id, promoType: 'video' } },
      { returnDocument: 'after' }
    ).lean();
    if (movie) await sendMovieAdvertisement(movie);
    reset(ctx);
    return ctx.reply(movie ? 'Reklama media si yangilandi va kanalga yuborildi.' : 'Kino topilmadi.', movie ? movieAdminKeyboard(movie.code) : adminKeyboard());
  }
  if (ctx.session?.step === 'movie_video') {
    ctx.session.movie.videoFileId = ctx.message.video.file_id;
    ctx.session.step = 'movie_promo';
    return ctx.reply('Kino uchun qisqa video yoki rasm yuboring:');
  }
  if (ctx.session?.step === 'movie_promo') {
    ctx.session.movie.promoFileId = ctx.message.video.file_id;
    ctx.session.movie.promoType = 'video';
    return finishMovieCreation(ctx);
  }
  return ctx.reply('Kino kodini yuboring.');
});

bot.on('photo', async (ctx) => {
  if (isAdmin(ctx) && ctx.session?.step === 'edit_movie_promo') {
    const movie = await Movie.findOneAndUpdate(
      { code: ctx.session.movieCode },
      { $set: { promoFileId: ctx.message.photo.at(-1).file_id, promoType: 'photo' } },
      { returnDocument: 'after' }
    ).lean();
    if (movie) await sendMovieAdvertisement(movie);
    reset(ctx);
    return ctx.reply(movie ? 'Reklama media si yangilandi va kanalga yuborildi.' : 'Kino topilmadi.', movie ? movieAdminKeyboard(movie.code) : adminKeyboard());
  }
  if (!isAdmin(ctx) || ctx.session?.step !== 'movie_promo') return ctx.reply('Kino kodini yuboring.');
  ctx.session.movie.promoFileId = ctx.message.photo.at(-1).file_id;
  ctx.session.movie.promoType = 'photo';
  return finishMovieCreation(ctx);
});

async function finishMovieCreation(ctx) {
  const movie = await Movie.create(ctx.session.movie);
  await sendMovieAdvertisement(movie);
  reset(ctx);
  return ctx.reply(`Kino joylandi va ${data.settings.movieChannel.username} kanaliga reklama yuborildi.`, adminKeyboard());
}

bot.on('text', async (ctx) => {
  const value = ctx.message.text.trim();
  const step = ctx.session?.step;
  if (step === 'find_movie') {
    if (!/^\d+$/.test(value)) return ctx.reply('Kino kodi faqat raqamlardan iborat bo\'lishi kerak:');
    const movie = await Movie.findOne({ code: value }).lean();
    if (!movie) return ctx.reply('Kino topilmadi. Boshqa kod yuboring:', adminKeyboard());
    reset(ctx);
    return ctx.reply(movieAdminText(movie), movieAdminKeyboard(movie.code));
  }
  if (/^edit_movie_(title|code|genre|language)$/.test(step || '')) {
    const field = step.slice('edit_movie_'.length);
    if (field === 'code') {
      if (!/^\d+$/.test(value)) return ctx.reply('Kino kodi faqat raqam bo\'lishi kerak:');
      if (value !== ctx.session.movieCode && await Movie.exists({ code: value })) return ctx.reply('Bu kino kodi band. Boshqa kod yuboring:');
    }
    const movie = await Movie.findOneAndUpdate(
      { code: ctx.session.movieCode },
      { $set: { [field]: value } },
      { returnDocument: 'after' }
    ).lean();
    reset(ctx);
    return ctx.reply(movie ? 'Kino ma\'lumoti yangilandi.' : 'Kino topilmadi.', movie ? movieAdminKeyboard(movie.code) : adminKeyboard());
  }
  if (step === 'movie_channel') {
    try {
      data.settings.movieChannel = await checkFullAdmin(ctx, normalizeChannel(value));
      await saveSettings();
      reset(ctx);
      return ctx.reply(`Kino reklama kanali ${data.settings.movieChannel.username} qilib saqlandi.`, adminKeyboard());
    } catch (error) {
      return ctx.reply(error.message);
    }
  }
  if (step === 'required_subscription_channel') {
    try {
      const channel = await checkFullAdmin(ctx, normalizeChannel(value));
      if (!data.settings.requiredChannels.some((item) => item.id === channel.id)) data.settings.requiredChannels.push(channel);
      await saveSettings();
      reset(ctx);
      return ctx.reply(`${channel.title} majburiy obuna kanaliga qo'shildi.`, adminKeyboard());
    } catch (error) {
      return ctx.reply(error.message);
    }
  }
  if (step === 'movie_title') {
    ctx.session.movie = { title: value };
    ctx.session.step = 'movie_code';
    return ctx.reply('Kino kodini yuboring (masalan: 1001):');
  }
  if (step === 'movie_code') {
    if (!/^\d+$/.test(value)) return ctx.reply('Kod faqat raqamlardan iborat bo\'lishi kerak. Qayta yuboring:');
    if (await Movie.exists({ code: value })) return ctx.reply('Bu kino kodi band. Boshqa kod yuboring:');
    ctx.session.movie.code = value;
    ctx.session.step = 'movie_genre';
    return ctx.reply('Kino janrini yuboring:');
  }
  if (step === 'movie_genre') {
    ctx.session.movie.genre = value;
    ctx.session.step = 'movie_language';
    return ctx.reply('Kino tilini yuboring:');
  }
  if (step === 'movie_language') {
    ctx.session.movie.language = value;
    ctx.session.step = 'movie_video';
    return ctx.reply('Kino videosini yuboring:');
  }
  if (/^\d+$/.test(value)) return sendMovie(ctx, value);
  return ctx.reply('Kino kodi xato. Raqamli kino kodini yuboring.');
});

bot.catch((error, ctx) => {
  console.error(`Update ${ctx.updateType} failed:`, error.response?.description || error.message);
  safeAnswerCbQuery(ctx);
});

async function safeAnswerCbQuery(ctx) {
  if (!ctx.callbackQuery) return;
  try { await ctx.answerCbQuery(); } catch {}
}

async function startBot() {
  await hydrateSettings();
  await bot.launch();
  console.log('Movie bot ishga tushdi.');
}

startBot().catch((error) => {
  console.error('Bot startup failed:', error);
  process.exitCode = 1;
});

process.once('SIGINT', async () => { bot.stop('SIGINT'); await mongoose.disconnect(); });
process.once('SIGTERM', async () => { bot.stop('SIGTERM'); await mongoose.disconnect(); });
