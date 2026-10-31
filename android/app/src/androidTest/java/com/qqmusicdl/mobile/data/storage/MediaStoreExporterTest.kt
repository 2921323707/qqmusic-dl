package com.qqmusicdl.mobile.data.storage

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.qqmusicdl.mobile.data.model.LibraryEntry
import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MediaStoreExporterTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val exporter = MediaStoreExporter(context)
    private val localFiles = mutableListOf<File>()
    private val exportedFiles = mutableListOf<File>()

    @Before
    fun grantLegacyStoragePermission() {
        assumeTrue(Build.VERSION.SDK_INT < Build.VERSION_CODES.Q)
        val permissions = listOf(
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE,
        )
        permissions.forEach { permission ->
            val output = instrumentation.uiAutomation.executeShellCommand(
                "pm grant ${context.packageName} $permission",
            ).use { descriptor ->
                ParcelFileDescriptor.AutoCloseInputStream(descriptor).bufferedReader().readText()
            }
            assertTrue(
                "pm grant $permission failed: $output",
                context.checkSelfPermission(permission) == PackageManager.PERMISSION_GRANTED,
            )
        }
    }

    @After
    fun cleanUp() {
        localFiles.forEach(File::delete)
        exportedFiles.forEach(File::delete)
    }

    @Test
    fun deleteRemovesLegacyMediaStoreFile() = runBlocking {
        val localFile = File(
            context.cacheDir,
            "legacy-delete-test-${System.nanoTime()}.mp3",
        ).apply {
            writeBytes(ByteArray(1024) { it.toByte() })
        }
        localFiles += localFile
        val entry = LibraryEntry(
            id = "test",
            mid = "test",
            title = "Legacy delete test",
            artist = "qqmusic-dl",
            album = "Test",
            coverUrl = null,
            qualityCode = "M500",
            qualityLabel = "MP3 128",
            localPath = localFile.absolutePath,
            exportedUri = null,
            createdAtMillis = 0,
        )

        val uri = exporter.export(entry)
        assertNotNull(uri)
        val exportedFile = File(
            File(
                Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC),
                "qqmusic-dl",
            ),
            localFile.name,
        )
        exportedFiles += exportedFile
        assertTrue(exportedFile.isFile)

        exporter.delete(uri.toString(), localFile.name)

        assertFalse(exportedFile.exists())
    }
}
