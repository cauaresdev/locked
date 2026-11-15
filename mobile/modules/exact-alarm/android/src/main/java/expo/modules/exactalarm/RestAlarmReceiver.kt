package expo.modules.exactalarm

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock

/**
 * End-of-rest alarm, posted natively instead of through expo-notifications: Android 15+ only keeps
 * a channel's alarm audio (which sounds with the phone on vibrate, at alarm volume) for
 * notifications in the alarm category, and expo-notifications can't set a category.
 */
class RestAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val tag = intent.getStringExtra(EXTRA_TAG) ?: return
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
    val open = launch?.let {
      PendingIntent.getActivity(context, tag.hashCode(), it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    val notification = Notification.Builder(context, intent.getStringExtra(EXTRA_CHANNEL) ?: return)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(intent.getStringExtra(EXTRA_TITLE))
      .setContentText(intent.getStringExtra(EXTRA_BODY))
      .setCategory(Notification.CATEGORY_ALARM)
      .setVisibility(Notification.VISIBILITY_PUBLIC)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()
    (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(tag, NOTIFICATION_ID, notification)
  }

  companion object {
    const val NOTIFICATION_ID = 7301
    private const val EXTRA_TAG = "tag"
    private const val EXTRA_CHANNEL = "channel"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_BODY = "body"

    private fun pending(context: Context, tag: String, intent: Intent? = null): PendingIntent? {
      val i = intent ?: Intent(context, RestAlarmReceiver::class.java)
      val flags = PendingIntent.FLAG_IMMUTABLE or
        (if (intent == null) PendingIntent.FLAG_NO_CREATE else PendingIntent.FLAG_UPDATE_CURRENT)
      return PendingIntent.getBroadcast(context, tag.hashCode(), i, flags)
    }

    /** Exact when "Alarms & reminders" is allowed; otherwise Android may deliver it late. */
    fun schedule(context: Context, tag: String, delayMs: Long, channel: String, title: String, body: String) {
      val intent = Intent(context, RestAlarmReceiver::class.java)
        .putExtra(EXTRA_TAG, tag)
        .putExtra(EXTRA_CHANNEL, channel)
        .putExtra(EXTRA_TITLE, title)
        .putExtra(EXTRA_BODY, body)
      val pi = pending(context, tag, intent) ?: return
      val alarms = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val at = SystemClock.elapsedRealtime() + delayMs
      val exact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarms.canScheduleExactAlarms()
      if (exact) alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
      else alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pi)
    }

    fun cancel(context: Context, tag: String) {
      pending(context, tag)?.let {
        (context.getSystemService(Context.ALARM_SERVICE) as AlarmManager).cancel(it)
        it.cancel()
      }
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancel(tag, NOTIFICATION_ID)
    }

    fun shown(context: Context, tag: String): Boolean =
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).activeNotifications
        .any { it.tag == tag && it.id == NOTIFICATION_ID }
  }
}
