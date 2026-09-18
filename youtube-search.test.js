process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'test-token';
process.env.MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/test';
process.env.BOT_USERNAME = process.env.BOT_USERNAME || 'testbot';
process.env.ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
process.env.ADMIN_TG_ID = process.env.ADMIN_TG_ID || '123456789';
process.env.YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || 'test-youtube-key';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildYoutubeSearchUrl, normalizeYouTubeSearchResult } = require('./bot');

test('buildYoutubeSearchUrl includes query and API key', () => {
  const url = buildYoutubeSearchUrl('billie eilish', 'secret-key');
  assert.match(url, /youtube\.googleapis\.com\/youtube\/v3\/search/);
  assert.match(url, /q=billie%20eilish/);
  assert.match(url, /key=secret-key/);
});

test('normalizeYouTubeSearchResult maps video metadata correctly', () => {
  const result = normalizeYouTubeSearchResult({
    id: { videoId: 'abc123' },
    snippet: {
      title: 'Lovely',
      channelTitle: 'Billie Eilish',
      thumbnails: { high: { url: 'https://example.com/thumb.jpg' } }
    }
  });

  assert.equal(result.id, 'abc123');
  assert.equal(result.title, 'Lovely');
  assert.equal(result.artist, 'Billie Eilish');
  assert.equal(result.downloadUrl, 'https://www.youtube.com/watch?v=abc123');
});
