package com.qqmusicdl.mobile

import android.Manifest
import android.os.Bundle
import android.os.Build
import android.content.pm.PackageManager
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import com.qqmusicdl.mobile.ui.MobileApp
import com.qqmusicdl.mobile.ui.theme.QqMusicDlTheme

class MainActivity : ComponentActivity() {
    private val storagePermissions = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val legacyStoragePermissions = arrayOf(
            Manifest.permission.READ_EXTERNAL_STORAGE,
            Manifest.permission.WRITE_EXTERNAL_STORAGE,
        )
        if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.P &&
            legacyStoragePermissions.any {
                ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
            }
        ) {
            storagePermissions.launch(legacyStoragePermissions)
        }
        enableEdgeToEdge()
        setContent {
            QqMusicDlTheme {
                val viewModel: AppViewModel = viewModel()
                MobileApp(viewModel)
            }
        }
    }
}
