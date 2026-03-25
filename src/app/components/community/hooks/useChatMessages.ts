import { useState, useEffect, useCallback } from "react";
import { chatService, type ChatMessage } from "../../../services/ChatProxyService";
import { chatUserService } from "../../../services/ChatUserService";

export function useChatMessages(config: any) {
  const currentUserId = chatUserService.getUserId();
  
  // Backend proxy mode indicator
  const [proxyMode, setProxyMode] = useState<"backend" | "mock">("mock");
  const [providerName, setProviderName] = useState("");

  const targetImUserId = config?.chatContact?.imUserId || "";
  const contactId = config?.chatContact?.id || "";
  const targetId = targetImUserId || contactId;

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: "m1",
      channelName: "default-channel",
      type: "image",
      content: "https://images.unsplash.com/photo-1641029874359-780ba37bad59?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxjb3JuJTIwZmllbGQlMjBhZ3JpY3VsdHVyZSUyMGZhcm18ZW58MXx8fHwxNzcwODUzMDM3fDA&ixlib=rb-4.1.0&q=80&w=1080&utm_source=figma&utm_medium=referral",
      senderId: currentUserId,
      timestamp: Date.now() - 300000,
      status: "sent",
      read: true,
    },
    {
      id: "m2",
      channelName: "default-channel",
      type: "voice",
      content: "",
      duration: 8,
      senderId: currentUserId,
      timestamp: Date.now() - 240000,
      status: "sent",
      read: true,
    },
    {
      id: "m3",
      channelName: "default-channel",
      type: "voice",
      content: "",
      duration: 6,
      senderId: contactId,
      timestamp: Date.now() - 180000,
      status: "sent",
      read: false,
    },
    {
      id: "m4",
      channelName: "default-channel",
      type: "text",
      content: "推荐使用TaprootAgro的Atrazine+nicosulfuron混合方案，suggest TaprootAgro's mix plan",
      senderId: contactId,
      timestamp: Date.now() - 120000,
      status: "sent",
      read: false,
    },
  ]);
  
  const [isSending, setIsSending] = useState(false);

  // ---- Generic optimistic send helper ----
  const sendWithOptimisticUpdate = useCallback(
    async (
      msgOverrides: Partial<ChatMessage> & { type: ChatMessage['type'] },
      serviceSend: () => Promise<ChatMessage>,
      opts?: { setLoading?: boolean }
    ) => {
      if (opts?.setLoading) setIsSending(true);

      const optimisticMsg: ChatMessage = {
        id: `m${Date.now()}_opt`,
        channelName: "default-channel",
        senderId: currentUserId,
        content: "",
        timestamp: Date.now(),
        status: "sending",
        read: false,
        ...msgOverrides,
      };

      setChatMessages((prev) => [...prev, optimisticMsg]);

      try {
        const sentMsg = await serviceSend();
        setChatMessages((prev) =>
          prev.map((m) => (m.id === optimisticMsg.id ? { ...sentMsg } : m))
        );
      } catch {
        setChatMessages((prev) =>
          prev.map((m) =>
            m.id === optimisticMsg.id ? { ...m, status: "failed" as const } : m
          )
        );
      } finally {
        if (opts?.setLoading) setIsSending(false);
      }
    },
    [currentUserId]
  );

  // Initialize chatService
  useEffect(() => {
    chatService.setUserId(currentUserId);
    setProxyMode(chatService.mode);
    setProviderName(chatService.providerInfo.name);
    chatService.setTargetUserId(targetImUserId);

    const channelId = config?.chatContact?.channelId || "";

    if (!channelId || channelId === "your-channel-id") {
      console.log("[Community] No channelId bound yet — waiting for QR scan");
      return;
    }

    console.log(`[Community] Channel: ${channelId} (me: ${currentUserId} → merchant: ${targetImUserId})`);

    const init = async () => {
      const regResult = await chatUserService.registerOnProvider();
      if (regResult.success) {
        console.log(`[Community] User ${currentUserId} registered on ${chatService.provider}`);
      } else {
        console.warn(`[Community] User registration issue: ${regResult.error}`);
      }

      try {
        await chatService.joinChannel(channelId);
        console.log(`[Community] Joined channel: ${channelId}`);
      } catch (err) {
        console.warn(`[Community] joinChannel failed (will poll with channel name anyway):`, err);
      }

      chatService.startPolling();
    };
    init();

    chatService.markSeen(["m1", "m2", "m3", "m4"]);

    const unsubscribe = chatService.onMessage((incomingMsg) => {
      setChatMessages((prev) => [...prev, incomingMsg]);
    });

    return () => {
      unsubscribe();
      chatService.stopPolling();
    };
  }, [currentUserId, config?.chatContact?.channelId, targetImUserId]);

  const sendTextMessage = useCallback(async (content: string) => {
    await sendWithOptimisticUpdate(
      { type: "text", content },
      () => chatService.sendMessage(content, "text", undefined, targetId),
      { setLoading: true }
    );
  }, [sendWithOptimisticUpdate, targetId]);

  const sendVoiceMessage = useCallback(async (duration: number, audioBlob: Blob) => {
    // Create a local objectURL for immediate playback in the optimistic message
    const localAudioUrl = URL.createObjectURL(audioBlob);
    await sendWithOptimisticUpdate(
      { type: "voice", content: localAudioUrl, duration, audioUrl: localAudioUrl },
      () => chatService.sendMessage("", "voice", duration, targetId, audioBlob),
    );
  }, [sendWithOptimisticUpdate, targetId]);

  const sendImageMessage = useCallback(async (imageData: string) => {
    let compressed = imageData;
    try {
      const { compressImageBase64, COMPRESS_PRESETS } = await import('../../../utils/imageCompressor');
      compressed = await compressImageBase64(imageData, COMPRESS_PRESETS.chat);
    } catch (err) {
      console.warn('[Chat] Image compression failed, using original', err);
    }

    await sendWithOptimisticUpdate(
      { type: "image", content: compressed },
      () => chatService.sendMessage(compressed, "image", undefined, targetId),
    );
  }, [sendWithOptimisticUpdate, targetId]);

  return {
    chatMessages,
    proxyMode,
    providerName,
    currentUserId,
    isSending,
    sendTextMessage,
    sendVoiceMessage,
    sendImageMessage,
  };
}