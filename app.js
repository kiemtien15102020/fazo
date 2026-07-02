// CẤU HÌNH KẾT NỐI SUPABASE
const SUPABASE_URL = "https://nbciwifubobjohwmdjwg.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_-a4LSSVo-va31CIo7P5z4A_rMbL1tNj";

const spClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let selectedUserId = null; // ID của người dùng đang được ghé thăm hoặc chat riêng
let dmSubscription = null;
let globalUnreadStore = {}; // Lưu trữ số tin nhắn chưa đọc từ mỗi user {userId: count}

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80';

// KHỞI CHẠY KIỂM TRA ĐĂNG NHẬP
spClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        currentUser = session.user;
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        loadNewsfeed(); 
        loadProfileData();
        listenRealtimeChat(); 
        listenGlobalPrivateMessages(); // Bắt đầu lắng nghe thông báo tin nhắn riêng đến
    } else {
        currentUser = null;
        document.getElementById('login-page').classList.remove('hidden');
        document.getElementById('app-page').classList.add('hidden');
    }
});

// AUTHENTICATION FUNCTIONS
async function loginWithEmail() {
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const { error } = await spClient.auth.signInWithPassword({ email, password });
    if (error) alert("Đăng nhập thất bại: " + error.message);
}

async function loginWithGoogle() {
    const { error } = await spClient.auth.signInWithOAuth({ 
        provider: 'google',
        options: { redirectTo: window.location.origin + window.location.pathname }
    });
    if (error) alert("Lỗi kết nối Google: " + error.message);
}

async function logout() {
    await spClient.auth.signOut();
}

function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.remove('hidden');
    
    if (tabName !== 'dm-chat' && dmSubscription) {
        dmSubscription.unsubscribe();
        dmSubscription = null;
    }

    if (tabName === 'newsfeed') loadNewsfeed();
    if (tabName === 'profile') loadProfileData();
}

// MODULE 1: BẢNG TIN & ĐĂNG BÀI
async function createNewPost() {
    const content = document.getElementById('post-content').value;
    const imageInput = document.getElementById('post-image-input');
    const imageFile = imageInput.files[0];
    
    if(!content.trim() && !imageFile) return alert("Vui lòng nhập chữ hoặc chọn một bức ảnh!");

    let imageUrl = null;
    if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
        const { error: uploadError } = await spClient.storage.from('post-images').upload(fileName, imageFile);
        if (uploadError) return alert("Không tải được ảnh: " + uploadError.message);
        const { data } = spClient.storage.from('post-images').getPublicUrl(fileName);
        imageUrl = data.publicUrl;
    }

    const { error } = await spClient.from('posts').insert([{ user_id: currentUser.id, content: content, image_url: imageUrl }]);
    if (error) alert(error.message);
    else {
        document.getElementById('post-content').value = '';
        imageInput.value = '';
        loadNewsfeed(); 
    }
}

function renderPostList(posts, containerId) {
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    if (!posts || posts.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:#999; padding:20px;">Chưa có bài viết nào ở đây.</p>';
        return;
    }

    posts.forEach(post => {
        const likeCount = post.likes ? post.likes.length : 0;
        let commentHtml = '';
        if (post.comments) {
            post.comments.forEach(c => {
                commentHtml += `<div class="comment-item"><b>${c.profiles?.full_name || 'Đồng nghiệp'}:</b> ${c.content}</div>`;
            });
        }

        let imageHtml = post.image_url ? `<div style="margin-top:12px; text-align:center;"><img src="${post.image_url}" style="max-width:100%; border-radius:8px; max-height:350px; object-fit:contain;"></div>` : '';
        
        // Tích hợp hiện số tin nhắn chưa đọc cạnh tên user nếu có
        const unreadCount = globalUnreadStore[post.user_id] || 0;
        const badgeHtml = unreadCount > 0 ? `<span style="background:red; color:white; border-radius:10px; padding:2px 6px; font-size:11px; margin-left:5px; font-weight:bold;">${unreadCount} tin nhắn mới</span>` : '';

        const postCard = document.createElement('div');
        postCard.className = 'card post-card';
        postCard.innerHTML = `
            <div class="post-header" style="display:flex; gap:10px; align-items:center; cursor:pointer;" onclick="visitUserProfile('${post.user_id}')">
                <img src="${post.profiles?.avatar_url || DEFAULT_AVATAR}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                <div class="post-meta">
                    <h4 style="margin:0; color:#007bff;">${post.profiles?.full_name || 'Đồng nghiệp'} ${badgeHtml}</h4>
                    <span style="font-size:12px; color:#999;">${new Date(post.created_at).toLocaleString('vi-VN')}</span>
                </div>
            </div>
            <div class="post-body" style="margin-top:10px;">
                <p style="margin:0; white-space: pre-wrap;">${post.content}</p>
                ${imageHtml}
            </div>
            <div class="post-actions" style="margin-top:15px; display:flex; gap:10px;">
                <button onclick="likePost('${post.id}')">❤️ Thích (${likeCount})</button>
                <button onclick="deletePost('${post.id}', '${post.user_id}')">🗑️ Xóa</button>
            </div>
            <div class="comment-section" style="margin-top:15px; background:#f9f9f9; padding:10px; border-radius:5px;">
                <div class="comments-list">${commentHtml}</div>
                <div class="comment-input-group" style="display:flex; gap:5px; margin-top:10px;">
                    <input type="text" id="input-cmt-${post.id}" placeholder="Viết bình luận..." style="flex:1;">
                    <button onclick="sendComment('${post.id}')">Gửi</button>
                </div>
            </div>
        `;
        container.appendChild(postCard);
    });
}

async function loadNewsfeed() {
    const { data: posts, error } = await spClient
        .from('posts')
        .select(`id, content, created_at, user_id, image_url, profiles(full_name, avatar_url), comments(id, content, user_id, profiles(full_name)), likes(user_id)`)
        .order('created_at', { ascending: false });

    if (!error) renderPostList(posts, 'newsfeed-list');
}

async function likePost(postId) {
    await spClient.from('likes').insert([{ user_id: currentUser.id, post_id: postId }]);
    loadNewsfeed();
}

async function deletePost(postId, postOwnerId) {
    if(currentUser.id !== postOwnerId) return alert("Bạn chỉ có quyền xóa bài viết của chính mình!");
    if(confirm("Xóa bài viết này?")) {
        await spClient.from('posts').delete().eq('id', postId);
        loadNewsfeed();
    }
}

async function sendComment(postId) {
    const input = document.getElementById(`input-cmt-${postId}`);
    if(!input.value.trim()) return;
    await spClient.from('comments').insert([{ post_id: postId, user_id: currentUser.id, content: input.value }]);
    input.value = '';
    loadNewsfeed();
}

// MODULE 2: XEM TƯỜNG ĐỒNG NGHIỆP
async function visitUserProfile(userId) {
    if(userId === currentUser.id) {
        switchTab('profile');
        return;
    }
    selectedUserId = userId;
    switchTab('view-profile');

    const { data: prof } = await spClient.from('profiles').select('*').eq('id', userId).single();
    if(prof) {
        // Cập nhật số tin nhắn ngay cạnh tên trên tường nhà nếu có
        const unreadCount = globalUnreadStore[userId] || 0;
        const badgeTxt = unreadCount > 0 ? ` (${unreadCount} tin nhắn chưa đọc)` : '';
        
        document.getElementById('view-prof-avatar').src = prof.avatar_url || DEFAULT_AVATAR;
        document.getElementById('view-prof-name').innerText = (prof.full_name || 'Đồng nghiệp') + badgeTxt;
        document.getElementById('view-prof-status').innerText = prof.status ? `Status: ${prof.status}` : '';
        document.getElementById('view-prof-bio').innerText = prof.bio || 'Chưa viết tiểu sử.';
    }

    const { data: followCheck } = await spClient.from('follows').select('*').eq('follower_id', currentUser.id).eq('following_id', userId);
    const btnFollow = document.getElementById('btn-follow');
    if (followCheck && followCheck.length > 0) {
        btnFollow.innerText = "🔕 Hủy Theo Dõi";
        btnFollow.style.backgroundColor = "#dc3545";
    } else {
        btnFollow.innerText = "🔔 Theo Dõi";
        btnFollow.style.backgroundColor = "#007bff";
    }

    const { data: userPosts } = await spClient
        .from('posts')
        .select(`id, content, created_at, user_id, image_url, profiles(full_name, avatar_url), comments(id, content, user_id, profiles(full_name)), likes(user_id)`)
        .eq('user_id', userId)
        .order('created_at', { ascending: false });
        
    renderPostList(userPosts, 'user-posts-list');
}

async function toggleFollow() {
    const btnFollow = document.getElementById('btn-follow');
    if(btnFollow.innerText.includes("Theo Dõi") && !btnFollow.innerText.includes("Hủy")) {
        await spClient.from('follows').insert([{ follower_id: currentUser.id, following_id: selectedUserId }]);
    } else {
        await spClient.from('follows').delete().eq('follower_id', currentUser.id).eq('following_id', selectedUserId);
    }
    visitUserProfile(selectedUserId);
}

// MODULE 3: CƠ CHẾ CHAT RIÊNG 1-1 HOÀN CHỈNH & ĐỒNG BỘ THÔNG BÁO
async function openDirectMessage() {
    switchTab('dm-chat');
    
    // Khi mở khung chat, xóa bỏ trạng thái tin nhắn chưa đọc từ người này
    globalUnreadStore[selectedUserId] = 0;
    
    const { data: prof } = await spClient.from('profiles').select('full_name').eq('id', selectedUserId).single();
    document.getElementById('dm-target-name').innerText = `🔒 Chat riêng với: ${prof?.full_name || 'Đồng nghiệp'}`;
    
    await loadPrivateMessages();

    // Thiết lập Realtime riêng cho phòng chat này
    if(dmSubscription) dmSubscription.unsubscribe();
    
    dmSubscription = spClient.channel(`private-room-${selectedUserId}`)
    .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'private_messages' 
    }, payload => {
        const newMsg = payload.new;
        // Nếu tin nhắn thuộc cuộc hội thoại hiện tại, cập nhật ngay màn hình chat
        if ((newMsg.sender_id === selectedUserId && newMsg.receiver_id === currentUser.id) ||
            (newMsg.sender_id === currentUser.id && newMsg.receiver_id === selectedUserId)) {
            loadPrivateMessages();
        }
    })
    .subscribe();
}

async function loadPrivateMessages() {
    // Sử dụng bộ lọc chuẩn hóa mượt mà của Supabase nhằm gộp luồng tin nhắn 2 chiều công khai
    const { data: messages, error } = await spClient
        .from('private_messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    if (error) return;

    const chatBox = document.getElementById('dm-messages');
    chatBox.innerHTML = '';

    messages.forEach(m => {
        const isMine = m.sender_id === currentUser.id;
        const bubbleRow = document.createElement('div');
        bubbleRow.style.textAlign = isMine ? 'right' : 'left';
        bubbleRow.style.marginBottom = '8px';
        bubbleRow.innerHTML = `
            <div style="display:inline-block; background:${isMine ? '#dbeafe' : '#f1f5f9'}; color:${isMine ? '#1e40af' : '#333'}; padding:8px 14px; border-radius:12px; max-width:70%; word-break: break-word;">
                ${m.content}
            </div>
        `;
        chatBox.appendChild(bubbleRow);
    });
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendPrivateMessage() {
    const input = document.getElementById('dm-input');
    if(!input.value.trim()) return;

    const { error } = await spClient.from('private_messages').insert([
        { sender_id: currentUser.id, receiver_id: selectedUserId, content: input.value.trim() }
    ]);
    
    if (error) alert("Không gửi được tin: " + error.message);
    input.value = '';
    loadPrivateMessages();
}

// HÀM LẮNG NGHE TOÀN CỤC: Đếm và hiện thông báo tin nhắn chưa đọc kế bên tên user
function listenGlobalPrivateMessages() {
    spClient.channel('global-private-watcher')
    .on('postgres_changes', { 
        event: 'INSERT', 
        schema: 'public', 
        table: 'private_messages',
        filter: `receiver_id=eq.${currentUser.id}` // Chỉ theo dõi tin nhắn gửi đến mình
    }, payload => {
        const incomingMsg = payload.new;
        
        // Nếu mình đang KHÔNG ở trong phòng chat với người gửi, tăng thông báo lên
        const isCurrentlyChatting = (document.getElementById('tab-dm-chat').classList.contains('hidden') === false) && (selectedUserId === incomingMsg.sender_id);
        
        if (!isCurrentlyChatting) {
            globalUnreadStore[incomingMsg.sender_id] = (globalUnreadStore[incomingMsg.sender_id] || 0) + 1;
            
            // Kích hoạt load lại bảng tin để cập nhật số Badge cạnh tên
            if (!document.getElementById('tab-newsfeed').classList.contains('hidden')) {
                loadNewsfeed();
            }
            // Nếu đang xem tường người đó, cập nhật ngay
            if (!document.getElementById('tab-view-profile').classList.contains('hidden') && selectedUserId === incomingMsg.sender_id) {
                visitUserProfile(selectedUserId);
            }
        }
    })
    .subscribe();
}

// MODULE 4: CHAT TỔNG TOÀN CÔNG TY
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if(!input.value.trim()) return;
    await spClient.from('messages').insert([{ user_id: currentUser.id, content: input.value }]);
    input.value = '';
}

function listenRealtimeChat() {
    loadChatMessages();
    spClient.channel('public:messages').unsubscribe();
    spClient.channel('public:messages')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, payload => {
        loadChatMessages();
    })
    .subscribe();
}

async function loadChatMessages() {
    const { data: msgs } = await spClient.from('messages').select(`id, content, is_recalled, user_id, profiles(full_name)`).order('created_at', { ascending: true });
    if(!msgs) return;

    const chatArea = document.getElementById('chat-messages');
    chatArea.innerHTML = '';

    msgs.forEach(m => {
        const isMine = m.user_id === currentUser.id;
        const msgRow = document.createElement('div');
        msgRow.className = `msg-row ${isMine ? 'mine' : ''}`;
        
        let msgContent = m.is_recalled ? '<i>Tin nhắn đã bị thu hồi</i>' : m.content;
        let actionHtml = (isMine && !m.is_recalled) ? `<span class="msg-actions" onclick="recallMessage('${m.id}')">Thu hồi</span>` : '';

        msgRow.innerHTML = `
            <div class="msg-user" style="cursor:pointer; color:#007bff;" onclick="visitUserProfile('${m.user_id}')">${m.profiles?.full_name || 'Đồng nghiệp'}</div>
            <div class="msg-bubble">${msgContent}</div>
            ${actionHtml}
        `;
        chatArea.appendChild(msgRow);
    });
    chatArea.scrollTop = chatArea.scrollHeight;
}

async function recallMessage(msgId) {
    await spClient.from('messages').update({ is_recalled: true }).eq('id', msgId);
}

// MODULE 5: TRANG CÁ NHÂN CHÍNH CHỦ
async function loadProfileData() {
    const { data: prof } = await spClient.from('profiles').select('*').eq('id', currentUser.id).single();
    if(prof) {
        document.getElementById('prof-avatar').src = prof.avatar_url || DEFAULT_AVATAR;
        document.getElementById('prof-name').innerText = prof.full_name;
        document.getElementById('prof-status-input').value = prof.status || '';
        document.getElementById('prof-bio-input').value = prof.bio || '';
    }
}

async function updateProfile() {
    const status = document.getElementById('prof-status-input').value;
    const bio = document.getElementById('prof-bio-input').value;
    await spClient.from('profiles').update({ status, bio }).eq('id', currentUser.id);
    alert("Cập nhật thành công!");
}
