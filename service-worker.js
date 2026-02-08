// Service Worker for IPL Auction PWA
const CACHE_NAME = 'ipl-pro-hub-v2';
const urlsToCache = [
  '/',
  '/ipl.html',
  '/blind-auction.html',
  '/dashboard.html',
  '/profile.html',
  '/style.css',
  '/blind-auction-style.css',
  '/script.js',
  '/blind-auction-script.js',
  '/auth.js',
  '/live-stats.css',
  '/live-stats.js',
  '/chat-enhancements.css',
  '/chat-enhancements.js',
  '/effects.js',
  '/manifest.json'
];

// Install event - cache resources
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('📦 Caching app shell');
        return cache.addAll(urlsToCache);
      })
      .catch(err => console.log('Cache install error:', err))
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('🗑️ Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch event - Network First, then Cache
self.addEventListener('fetch', event => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;
  
  // Skip socket.io and API requests (always network)
  if (event.request.url.includes('socket.io') || 
      event.request.url.includes('/api/')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Response valid?
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }

        // Update cache with new version
        const responseToCache = response.clone();
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache);
          });

        return response;
      })
      .catch(() => {
        // Network failed, try cache
        console.log('Or offline, serving cached version for:', event.request.url);
        return caches.match(event.request)
          .then(response => {
             if (response) return response;
             // Fallback for HTML
             if (event.request.mode === 'navigate') {
                 return caches.match('/offline.html'); 
             }
          });
      })
  );
});

// Background sync for offline actions
self.addEventListener('sync', event => {
  if (event.tag === 'sync-auction-data') {
    event.waitUntil(syncAuctionData());
  }
});

async function syncAuctionData() {
  // Sync any pending auction actions when back online
  console.log('🔄 Syncing auction data...');
}

// Push notifications (future feature)
self.addEventListener('push', event => {
  const options = {
    body: event.data ? event.data.text() : 'New auction update!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('IPL Auction', options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.openWindow('/')
  );
});
