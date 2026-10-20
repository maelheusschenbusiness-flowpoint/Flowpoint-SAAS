import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageCircle, X, Send, Loader2, Bot, User } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { trackEvent } from "@/lib/analytics";

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export function SupportChat() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 0,
      role: "assistant",
      content: "Bonjour ! Je suis l'assistant Flowpoint. Comment puis-je vous aider aujourd'hui ?",
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    // Keep the desktop convenience without opening the mobile keyboard
    // as soon as the chat button is tapped.
    const isMobile = window.matchMedia("(max-width: 639px)").matches;
    if (isOpen && inputRef.current && !isMobile) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const createConversation = async (): Promise<{ id: number; token: string } | null> => {
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Support Chat" }),
      });
      if (res.ok) {
        const data = await res.json();
        setConversationId(data.id);
        setSessionToken(data.sessionToken);
        return { id: data.id, token: data.sessionToken };
      }
    } catch (error) {
      console.error("Failed to create conversation:", error);
    }
    return null;
  };

  const sendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [
      ...prev,
      { id: Date.now(), role: "user", content: userMessage },
    ]);
    setIsLoading(true);
    setAnnouncement("L'assistant prépare sa réponse.");

    try {
      let convId = conversationId;
      let token = sessionToken;
      if (!convId || !token) {
        const created = await createConversation();
        if (!created) {
          throw new Error("Failed to create conversation");
        }
        convId = created.id;
        token = created.token;
      }

      const response = await fetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Token": token },
        body: JSON.stringify({ content: userMessage }),
      });

      if (!response.ok) {
        throw new Error("Failed to send message");
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let assistantMessage = "";
      const assistantId = Date.now() + 1;

      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", content: "" },
      ]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.content) {
                assistantMessage += data.content;
                setMessages((prev) =>
                  prev.map((msg) =>
                    msg.id === assistantId
                      ? { ...msg, content: assistantMessage }
                      : msg
                  )
                );
              }
            } catch {
            }
          }
        }
      }
      trackEvent("support_chat_message_sent", { location: "support_widget" });
      setAnnouncement(
        assistantMessage
          ? `Réponse du support : ${assistantMessage}`
          : "Aucune réponse du support reçue."
      );
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage = "Désolé, une erreur s'est produite. Veuillez réessayer.";
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now(),
          role: "assistant",
          content: errorMessage,
        },
      ]);
      setAnnouncement(`Erreur du support : ${errorMessage}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-24 right-6 z-50 flex w-[380px] max-w-[calc(100vw-48px)] flex-col max-sm:inset-x-4 max-sm:w-auto max-sm:max-w-none"
          >
            <Card className="flex max-h-[calc(100dvh-6rem)] flex-col overflow-hidden border-0 shadow-2xl">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-900 dark:to-indigo-900 text-white p-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-full">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold" data-testid="text-chat-title">Support Flowpoint</h3>
                    <p className="text-xs text-blue-100" data-testid="text-chat-subtitle">Assistance IA 24/7</p>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="text-white"
                  onClick={() => setIsOpen(false)}
                  aria-label="Fermer le chat"
                  data-testid="button-close-chat"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>

              <ScrollArea className="h-[350px] max-h-[calc(100dvh-15rem)] min-h-0 shrink bg-white p-4 dark:bg-slate-900" ref={scrollRef}>
                <div className="space-y-4">
                  {messages.map((message) => (
                    <div
                      key={message.id}
                      className={`flex gap-3 ${
                        message.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      {message.role === "assistant" && (
                        <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                          <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          message.role === "user"
                            ? "bg-blue-600 dark:bg-blue-800 text-white"
                            : "bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                        }`}
                        data-testid={`text-message-${message.role}-${message.id}`}
                      >
                        <div className="text-sm leading-relaxed space-y-3">
                          {message.content.split('\n\n').map((paragraph, idx) => (
                            <p key={idx} className="whitespace-pre-wrap">{paragraph}</p>
                          ))}
                        </div>
                      </div>
                      {message.role === "user" && (
                        <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
                          <User className="h-4 w-4 text-slate-600 dark:text-slate-300" />
                        </div>
                      )}
                    </div>
                  ))}
                  {isLoading && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex gap-3 justify-start">
                      <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl px-4 py-2">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
                      </div>
                    </div>
                  )}
                </div>
              </ScrollArea>
              <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {announcement}
              </div>

              <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
                <div className="flex gap-2">
                  <label htmlFor="support-chat-message" className="sr-only">
                    Message au support
                  </label>
                  <Input
                    id="support-chat-message"
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Tapez votre message..."
                    className="flex-1 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100 dark:placeholder:text-slate-400"
                    disabled={isLoading}
                    data-testid="input-chat-message"
                  />
                  <Button
                    size="icon"
                    onClick={sendMessage}
                    disabled={!input.trim() || isLoading}
                    className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-900 dark:hover:bg-blue-800"
                    aria-label="Envoyer le message"
                    data-testid="button-send-message"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ delay: 1, type: "spring" }}
        className="fixed bottom-6 right-6 z-50"
      >
        <Button
          onClick={() => {
            if (!isOpen) {
              trackEvent("support_chat_opened", { location: "floating_widget" });
            }
            setIsOpen(!isOpen);
          }}
          className={`rounded-full shadow-xl h-14 w-14 p-0 ${
            isOpen
              ? "bg-slate-500 dark:bg-slate-600"
              : "bg-gradient-to-r from-blue-600 to-indigo-600 dark:from-blue-900 dark:to-indigo-900 text-white"
          }`}
          aria-label={isOpen ? "Fermer le chat" : "Ouvrir le chat"}
          aria-expanded={isOpen}
          data-testid="button-open-chat"
        >
          {isOpen ? (
            <X className="h-6 w-6" />
          ) : (
            <MessageCircle className="h-6 w-6" />
          )}
        </Button>
        {!isOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-5 w-5 bg-green-500"></span>
          </span>
        )}
      </motion.div>
    </>
  );
}
