package expo.modules.exactalarm

import android.app.AlarmManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Exact-alarm access (Android 12+), which expo-notifications checks internally but does not expose.
 * Without it, scheduled notifications fall back to inexact alarms that Android may hold back by most of
 * their interval: a 60 s rest alert arrived 47 s late in testing.
 */
class ExactAlarmModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExactAlarm")

    Function("canScheduleExactAlarms") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@Function true
      val context = appContext.reactContext ?: return@Function true
      (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).canScheduleExactAlarms()
    }

    // End-of-rest alarm in the alarm category (see RestAlarmReceiver).
    Function("scheduleRestAlarm") { tag: String, delayMs: Double, channel: String, title: String, body: String ->
      val context = appContext.reactContext ?: return@Function false
      RestAlarmReceiver.schedule(context, tag, delayMs.toLong(), channel, title, body)
      true
    }

    Function("cancelRestAlarm") { tag: String ->
      appContext.reactContext?.let { RestAlarmReceiver.cancel(it, tag) }
    }

    Function("restAlarmShown") { tag: String ->
      appContext.reactContext?.let { RestAlarmReceiver.shown(it, tag) } ?: false
    }

    // Opens this app's "Alarms & reminders" switch.
    Function("openSettings") {
      val context = appContext.reactContext
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && context != null) {
        context.startActivity(
          Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
      }
    }
  }
}
