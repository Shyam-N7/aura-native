package com.doublesymmetry.kotlinaudio.players.components

import android.content.Context
import com.doublesymmetry.kotlinaudio.models.CacheConfig
import com.google.android.exoplayer2.database.DatabaseProvider
import com.google.android.exoplayer2.database.StandaloneDatabaseProvider
import com.google.android.exoplayer2.upstream.cache.LeastRecentlyUsedCacheEvictor
import com.google.android.exoplayer2.upstream.cache.SimpleCache
import java.io.File

object PlayerCache {
    @Volatile
    private var instance: SimpleCache? = null

    fun getInstance(context: Context, cacheConfig: CacheConfig): SimpleCache? {
        val cacheDir = File(context.cacheDir, cacheConfig.identifier)
        val db: DatabaseProvider = StandaloneDatabaseProvider(context)
        // AURA: maxCacheSize is KILOBYTES — both CacheConfig's own doc and
        // RNTP's public PlayerOptions.maxCacheSize say so — but
        // LeastRecentlyUsedCacheEvictor takes BYTES. Passed through raw, a
        // 256 MB request built a 256 KB cache: about two seconds of 320 kbps
        // audio, so nothing was ever reused and the whole disk-cache layer
        // (docs/perf/02, layer 3) was inert. Convert at the boundary and the
        // documented unit stays true for every caller.
        val maxBytes = (cacheConfig.maxCacheSize ?: 0) * 1024

        instance ?: synchronized(this) {
            instance ?: SimpleCache(cacheDir, LeastRecentlyUsedCacheEvictor(maxBytes), db)
                .also { instance = it }
        }

        return instance
    }
}