"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { dueCalendarReminders, type CalendarEventRecord } from "../../../../src/lib/github-data/calendar-events";

export type CalendarNotificationState = "unsupported" | "default" | "denied" | "granted";

function readNotificationState(): CalendarNotificationState {
  if (typeof window === "undefined" || !("Notification" in window) || !("serviceWorker" in navigator)) return "unsupported";
  return Notification.permission;
}

export function useCalendarReminders(records: CalendarEventRecord[]) {
  const [permission, setPermission] = useState<CalendarNotificationState>("unsupported");
  const [deliveryError, setDeliveryError] = useState("");
  const delivered = useRef(new Set<string>());

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setPermission(readNotificationState()), 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const deliverDue = useCallback(async () => {
    if (readNotificationState() !== "granted") return;
    const registration = await navigator.serviceWorker.ready;
    for (const reminder of dueCalendarReminders(records)) {
      if (delivered.current.has(reminder.deliveryKey)) continue;
      await registration.showNotification("日程提醒", {
        body: reminder.event.data.title,
        tag: `calendar-reminder:${reminder.deliveryKey}`,
        data: { url: "/#calendar-title" },
      });
      delivered.current.add(reminder.deliveryKey);
    }
  }, [records]);

  useEffect(() => {
    void deliverDue().catch(() => setDeliveryError("此设备暂时无法显示提醒；日程数据仍已安全保存。"));
    const intervalId = window.setInterval(() => {
      void deliverDue().catch(() => setDeliveryError("此设备暂时无法显示提醒；日程数据仍已安全保存。"));
    }, 30_000);
    const resume = () => {
      if (document.visibilityState === "visible") void deliverDue().catch(() => setDeliveryError("此设备暂时无法显示提醒；日程数据仍已安全保存。"));
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [deliverDue]);

  const requestPermission = useCallback(async () => {
    setDeliveryError("");
    if (readNotificationState() === "unsupported") {
      setPermission("unsupported");
      return "unsupported" as const;
    }
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result === "granted") await deliverDue();
      return result;
    } catch {
      setDeliveryError("浏览器没有完成通知授权；你可以稍后在受支持的已安装 PWA 中重试。");
      return readNotificationState();
    }
  }, [deliverDue]);

  return { permission, deliveryError, requestPermission };
}
