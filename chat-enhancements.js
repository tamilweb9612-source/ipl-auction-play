// Enhanced Chat Manager
class EnhancedChatManager {
    constructor() {
        this.emojis = ['😀', '😂', '🤣', '😊', '😍', '🤔', '😮', '😢', '😡', '👍', '👎', '❤️', '🔥', '💰', '🎉', '👏', '🏆', '⚡'];
        this.quickMessages = [
            'Nice bid! 👍',
            'Too expensive! 💸',
            'Good deal! 💰',
            'Let it go...',
            'Great pick! 🎯',
            'Overpaid! 😅'
        ];
        this.reactions = ['👍', '😂', '🔥', '💰', '😮', '❤️'];
        this.messageReactions = {}; // Store reactions per message
        this.init();
    }

    init() {
        this.createEmojiPicker();
        this.enhanceChatInput();
        this.setupEventListeners();
    }

    createEmojiPicker() {
        const picker = document.createElement('div');
        picker.id = 'chatEmojiPicker';
        picker.className = 'chat-emoji-picker';
        
        // Emoji grid
        const emojiGrid = document.createElement('div');
        emojiGrid.className = 'emoji-grid';
        this.emojis.forEach(emoji => {
            const btn = document.createElement('button');
            btn.className = 'emoji-btn';
            btn.textContent = emoji;
            btn.onclick = () => this.insertEmoji(emoji);
            emojiGrid.appendChild(btn);
        });
        
        // Quick messages
        const quickMsgs = document.createElement('div');
        quickMsgs.className = 'quick-messages';
        quickMsgs.innerHTML = '<div style="color: #aaa; font-size: 0.75rem; margin-bottom: 8px;">QUICK MESSAGES</div>';
        this.quickMessages.forEach(msg => {
            const btn = document.createElement('button');
            btn.className = 'quick-msg-btn';
            btn.textContent = msg;
            btn.onclick = () => this.sendQuickMessage(msg);
            quickMsgs.appendChild(btn);
        });
        
        picker.appendChild(emojiGrid);
        picker.appendChild(quickMsgs);
        
        // Insert before chat input
        const chatPanel = document.querySelector('.chat-panel');
        if (chatPanel) {
            chatPanel.appendChild(picker);
        }
    }

    enhanceChatInput() {
        const chatInput = document.getElementById('chatInput');
        if (!chatInput) return;
        
        // Wrap input in container
        const wrapper = document.createElement('div');
        wrapper.className = 'chat-input-wrapper';
        chatInput.parentNode.insertBefore(wrapper, chatInput);
        wrapper.appendChild(chatInput);
        
        // Add emoji toggle button
        const emojiBtn = document.createElement('button');
        emojiBtn.className = 'emoji-toggle-btn';
        emojiBtn.innerHTML = '😀';
        emojiBtn.onclick = () => this.toggleEmojiPicker();
        wrapper.insertBefore(emojiBtn, chatInput);
        
        // Add typing indicator
        const typingIndicator = document.createElement('div');
        typingIndicator.id = 'typingIndicator';
        typingIndicator.className = 'typing-indicator';
        typingIndicator.innerHTML = '<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> Someone is typing...';
        
        const chatMessages = document.getElementById('chatMessages');
        if (chatMessages) {
            chatMessages.parentNode.insertBefore(typingIndicator, chatMessages.nextSibling);
        }
        
        // Typing detection
        let typingTimeout;
        chatInput.addEventListener('input', () => {
            if (typeof socket !== 'undefined') {
                socket.emit('typing_start');
                clearTimeout(typingTimeout);
                typingTimeout = setTimeout(() => {
                    socket.emit('typing_stop');
                }, 1000);
            }
        });
    }

    setupEventListeners() {
        // Close emoji picker when clicking outside
        document.addEventListener('click', (e) => {
            const picker = document.getElementById('chatEmojiPicker');
            const toggleBtn = document.querySelector('.emoji-toggle-btn');
            if (picker && !picker.contains(e.target) && e.target !== toggleBtn) {
                picker.classList.remove('active');
            }
        });
        
        // Socket listeners
        if (typeof socket !== 'undefined') {
            socket.on('user_typing', (data) => this.showTypingIndicator(data.userName));
            socket.on('user_stopped_typing', () => this.hideTypingIndicator());
            socket.on('message_reaction', (data) => this.updateReaction(data));
        }
    }

    toggleEmojiPicker() {
        const picker = document.getElementById('chatEmojiPicker');
        if (picker) {
            picker.classList.toggle('active');
        }
    }

    insertEmoji(emoji) {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value += emoji;
            input.focus();
        }
        this.toggleEmojiPicker();
    }

    sendQuickMessage(message) {
        const input = document.getElementById('chatInput');
        if (input) {
            input.value = message;
            document.getElementById('sendChatBtn')?.click();
        }
        this.toggleEmojiPicker();
    }

    enhanceMessage(messageElement, messageId) {
        // Add reaction buttons
        const reactionsDiv = document.createElement('div');
        reactionsDiv.className = 'chat-message-reactions';
        
        this.reactions.forEach(emoji => {
            const reactionBtn = document.createElement('button');
            reactionBtn.className = 'reaction-btn';
            reactionBtn.innerHTML = `${emoji} <span class="reaction-count">0</span>`;
            reactionBtn.onclick = () => this.addReaction(messageId, emoji);
            reactionsDiv.appendChild(reactionBtn);
        });
        
        // Add action buttons
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';
        actionsDiv.innerHTML = `
            <button class="message-action-btn" onclick="enhancedChat.addReaction('${messageId}', '👍')" title="Like">👍</button>
            <button class="message-action-btn" onclick="enhancedChat.addReaction('${messageId}', '❤️')" title="Love">❤️</button>
        `;
        
        messageElement.appendChild(actionsDiv);
        messageElement.appendChild(reactionsDiv);
    }

    addReaction(messageId, emoji) {
        if (!this.messageReactions[messageId]) {
            this.messageReactions[messageId] = {};
        }
        if (!this.messageReactions[messageId][emoji]) {
            this.messageReactions[messageId][emoji] = 0;
        }
        this.messageReactions[messageId][emoji]++;
        
        // Emit to server
        if (typeof socket !== 'undefined') {
            socket.emit('add_reaction', { messageId, emoji });
        }
        
        this.updateReactionDisplay(messageId);
    }

    updateReaction(data) {
        const { messageId, emoji, count } = data;
        if (!this.messageReactions[messageId]) {
            this.messageReactions[messageId] = {};
        }
        this.messageReactions[messageId][emoji] = count;
        this.updateReactionDisplay(messageId);
    }

    updateReactionDisplay(messageId) {
        const messageEl = document.querySelector(`[data-message-id="${messageId}"]`);
        if (!messageEl) return;
        
        const reactionsDiv = messageEl.querySelector('.chat-message-reactions');
        if (!reactionsDiv) return;
        
        const reactions = this.messageReactions[messageId] || {};
        
        reactionsDiv.querySelectorAll('.reaction-btn').forEach(btn => {
            const emoji = btn.textContent.trim().charAt(0);
            const count = reactions[emoji] || 0;
            const countSpan = btn.querySelector('.reaction-count');
            if (countSpan) {
                countSpan.textContent = count;
            }
            btn.classList.toggle('active', count > 0);
        });
    }

    showTypingIndicator(userName) {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.innerHTML = `<span class="typing-dots"><span>.</span><span>.</span><span>.</span></span> ${userName} is typing...`;
            indicator.classList.add('active');
        }
    }

    hideTypingIndicator() {
        const indicator = document.getElementById('typingIndicator');
        if (indicator) {
            indicator.classList.remove('active');
        }
    }

    // Intercept original chat send to add enhancements
    enhanceSendMessage(originalSendFunction) {
        return function() {
            const input = document.getElementById('chatInput');
            if (input && input.value.trim()) {
                // Check for mentions (@username)
                const message = input.value;
                const hasMention = message.includes('@');
                
                // Send with metadata
                if (typeof socket !== 'undefined') {
                    socket.emit('chat_message', {
                        message: message,
                        hasMention: hasMention,
                        timestamp: Date.now()
                    });
                }
                
                input.value = '';
            }
        };
    }
}

// Initialize enhanced chat
let enhancedChat = null;

// Auto-initialize when chat is available
document.addEventListener('DOMContentLoaded', () => {
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        enhancedChat = new EnhancedChatManager();
    }
});

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
    module.exports = EnhancedChatManager;
}
