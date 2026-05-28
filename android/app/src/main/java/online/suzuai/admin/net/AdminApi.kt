package online.suzuai.admin.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

// REST client for the admin namespace on a running Suzu AI server.
// All calls are authenticated with Bearer SUZU_ADMIN_TOKEN.
class AdminApi(private val baseUrl: String, private val token: String) {
    private val http: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMedia = "application/json".toMediaType()

    private fun url(path: String): String {
        val b = baseUrl.trimEnd('/')
        return if (path.startsWith("/")) "$b$path" else "$b/$path"
    }

    private fun authed(b: Request.Builder): Request.Builder =
        b.header("Authorization", "Bearer $token").header("Accept", "application/json")

    suspend fun health(): Result<Boolean> = withContext(Dispatchers.IO) {
        runCatching {
            val req = authed(Request.Builder().url(url("/api/admin/health")).get()).build()
            http.newCall(req).execute().use { it.isSuccessful }
        }
    }

    suspend fun getConfig(): Result<JSONObject> = withContext(Dispatchers.IO) {
        runCatching {
            val req = authed(Request.Builder().url(url("/api/admin/config")).get()).build()
            http.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                check(resp.isSuccessful) { "HTTP ${resp.code}: $body" }
                JSONObject(body)
            }
        }
    }

    suspend fun setConfig(
        baseApiUrl: String? = null,
        model: String? = null,
        apiKey: String? = null,
        domain: String? = null,
    ): Result<Unit> = withContext(Dispatchers.IO) {
        runCatching {
            val body = JSONObject().apply {
                baseApiUrl?.let { put("base_url", it) }
                model?.let { put("model", it) }
                apiKey?.let { put("api_key", it) }
                domain?.let { put("domain", it) }
            }
            val req = authed(
                Request.Builder().url(url("/api/admin/config"))
                    .post(body.toString().toRequestBody(jsonMedia))
            ).build()
            http.newCall(req).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                check(resp.isSuccessful) { "HTTP ${resp.code}: $text" }
            }
        }
    }

    suspend fun listUsers(): Result<JSONArray> = withContext(Dispatchers.IO) {
        runCatching {
            val req = authed(Request.Builder().url(url("/api/admin/users")).get()).build()
            http.newCall(req).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                check(resp.isSuccessful) { "HTTP ${resp.code}: $body" }
                JSONObject(body).getJSONArray("users")
            }
        }
    }

    suspend fun grantPremium(userId: String, duration: String, limit: Long? = null): Result<Unit> =
        post("/api/admin/users/$userId/grant-premium", JSONObject().apply {
            put("duration", duration)
            limit?.let { put("limit", it) }
        })

    suspend fun extendPremium(userId: String, duration: String): Result<Unit> =
        post("/api/admin/users/$userId/extend-premium", JSONObject().apply {
            put("duration", duration)
        })

    suspend fun revokePremium(userId: String): Result<Unit> =
        post("/api/admin/users/$userId/revoke-premium", JSONObject())

    suspend fun setLimit(userId: String, limit: Long): Result<Unit> =
        post("/api/admin/users/$userId/limit", JSONObject().apply { put("limit", limit) })

    suspend fun resetTokens(userId: String): Result<Unit> =
        post("/api/admin/users/$userId/reset-tokens", JSONObject())

    // Streams the backup ZIP into [dest].
    suspend fun downloadBackup(dest: java.io.File): Result<Long> = withContext(Dispatchers.IO) {
        runCatching {
            val req = authed(Request.Builder().url(url("/api/admin/backup")).get()).build()
            http.newCall(req).execute().use { resp ->
                check(resp.isSuccessful) { "HTTP ${resp.code}" }
                val body = resp.body ?: error("empty body")
                dest.outputStream().use { out -> body.byteStream().copyTo(out) }
                dest.length()
            }
        }
    }

    // Uploads a backup ZIP as multipart form-data (field name "backup").
    suspend fun uploadRestore(src: java.io.File): Result<JSONObject> =
        withContext(Dispatchers.IO) {
            runCatching {
                val zipMedia = "application/zip".toMediaType()
                val multipart = MultipartBody.Builder()
                    .setType(MultipartBody.FORM)
                    .addFormDataPart("backup", src.name, src.asRequestBody(zipMedia))
                    .build()
                val req = authed(Request.Builder().url(url("/api/admin/restore")).post(multipart)).build()
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    check(resp.isSuccessful) { "HTTP ${resp.code}: $text" }
                    JSONObject(text)
                }
            }
        }

    private suspend fun post(path: String, body: JSONObject): Result<Unit> =
        withContext(Dispatchers.IO) {
            runCatching {
                val req = authed(
                    Request.Builder().url(url(path))
                        .post(body.toString().toRequestBody(jsonMedia))
                ).build()
                http.newCall(req).execute().use { resp ->
                    val text = resp.body?.string().orEmpty()
                    check(resp.isSuccessful) { "HTTP ${resp.code}: $text" }
                }
            }
        }
}
