// CẤU HÌNH KẾT NỐI SUPABASE
const SUPABASE_URL = "https://nbciwifubobjohwmdjwg.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_-a4LSSVo-va31CIo7P5z4A_rMbL1tNj";

const spClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
let currentUser = null;
let selectedUserId = null; // ID của người dùng đang được ghé thăm tường hoặc đang chat riêng
let dmSubscription = null;

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=80&h=80';

// KHỞI CHẠY KIỂM TRA ĐĂNG NHẬP
spClient.auth.onAuthStateChange((event, session) => {
    if (session) {
        currentUser = session.user;
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        loadNewsfeed(); // Chỉ tự động load duy nhất 1 lần khi mở app thành công
        loadProfileData();
        listenRealtimeChat(); 
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

// ĐIỀU HƯỚNG TAB CHUẨN (CHỈ LOAD KHI BẤM NÚT MENU THỦ CÔNG)
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.remove('hidden');
    
    // Ngắt realtime chat riêng nếu rời khỏi phòng chat riêng
    if (tabName !== 'dm-chat' && dmSubscription) {
        dmSubscription.unsubscribe();
        dmSubscription = null;
    }

    // Chỉ load dữ liệu khi người dùng chủ động click menu tương ứng
    if (tabName === 'newsfeed') loadNewsfeed();
    if (tabName === 'profile') loadProfileData();
}

// MODULE 1: BẢNG TIN & ĐĂNG ẢNH CHUẨN XÁC
async function createNewPost() {
    const content = document.getElementById('post-content').value;
    const imageInput = document.getElementById('post-image-input');
    const imageFile = imageInput.files[0];
    
    if(!content.trim() && !imageFile) return alert("Vui lòng nhập chữ hoặc chọn một bức ảnh!");

    let imageUrl = null;

    if (imageFile) {
        const fileExt = imageFile.name.split('.').pop();
        const fileName = `${currentUser.id}_${Date.now()}.${fileExt}`;
        
        // Đẩy ảnh lên Storage
        const { error: uploadError } = await spClient.storage
            .from('post-images')
            .upload(fileName, imageFile);

        if (uploadError) return alert("Không tải được ảnh: " + uploadError.message);

        // Lấy link Public chuẩn
        const { data } = spClient.storage.from('post-images').getPublicUrl(fileName);
        imageUrl = data.publicUrl;
    }

    const { error } = await spClient.from('posts').insert([
        { user_id: currentUser.id, content: content, image_url: imageUrl }
    ]);

    if (error) alert(error.message);
    else {
        document.getElementById('post-content').value = '';
        imageInput.value = '';
        loadNewsfeed(); // Tự động cập nhật bảng tin ngay khi đăng bài thành công
    }
}

// HÀM CHUNG ĐỂ HIỂN THỊ DANH SÁCH BÀI VIẾT (DÙNG CHUNG CHO BẢNG TIN VÀ TƯỜNG CÁ NHÂN)
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

        // Tạo thẻ hiển thị hình ảnh nếu có image_url
        let imageHtml = post.image_url ? `<div style="margin-top:12px; text-align:center;"><img src="${post.image_url}" style="max-width:100%; border-radius:8px; max-height:350px; object-fit:contain; border: 1px solid #eee;"></div>` : '';

        const postCard = document.createElement('div');
        postCard.className = 'card post-card';
        postCard.innerHTML = `
            <div class="post-header" style="display:flex; gap:10px; align-items:center; cursor:pointer;" onclick="visitUserProfile('${post.user_id}')">
                <img src="${post.profiles?.avatar_url || DEFAULT_AVATAR}" style="width:40px; height:40px; border-radius:50%; object-fit:cover;">
                <div class="post-meta">
                    <h4 style="margin:0; color:#007bff;">${post.profiles?.full_name || 'Đồng nghiệp'}</h4>
                    <span style="font-size:12px; color:#999;">${new Date(post.created_at).toLocaleString('vi-VN')}</span>
                </div>
            </div>
            <div class="post-body" style="margin-top:10px;">
                <p style="margin:0; white-space: pre-wrap;">${post.content}</p>
                ${imageHtml}
            </div>
            <div class="post-actions" style="margin-top:15px; display:flex; gap:10px;">
                <button onclick="likePost('${post.id}')" style="padding:5px 10px;">❤️ Thích (${likeCount})</button>
                <button onclick="deletePost('${post.id}', '${post.user_id}')" style="padding:5px 10px;">🗑️ Xóa</button>
            </div>
            <div class="comment-section" style="margin-top:15px; background:#f9f9f9; padding:10px; border-radius:5px;">
                <div class="comments-list">${commentHtml}</div>
                <div class="comment-input-group" style="display:flex; gap:5px; margin-top:10px;">
                    <input type="text" id="input-cmt-${post.id}" placeholder="Viết bình luận..." style="flex:1; padding:5px;">
                    <button onclick="sendComment('${post.id}')" style="padding:5px 10px;">Gửi</button>
                </div>
            </div>
        `;
        container.appendChild(postCard);
    });
}

async function loadNewsfeed() {
    // Kỹ thuật gộp luồng: lấy bài viết kèm ảnh, avatar, comment chỉ trong 1 request giúp chống lag
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

// MODULE 2: GHÉ THĂM TƯỜNG CÁ NHÂN NGƯỜI KHÁC & FOLLOW
async function visitUserProfile(userId) {
    if(userId === currentUser.id) {
        switchTab('profile');
        return;
    }
    selectedUserId = userId;
    switchTab('view-profile');

    // 1. Lấy thông tin cá nhân của người đó
    const { data: prof } = await spClient.from('profiles').select('*').eq('id', userId).single();
    if(prof) {
        document.getElementById('view-prof-avatar').src = prof.avatar_url || DEFAULT_AVATAR;
        document.getElementById('view-prof-name').innerText = prof.full_name || 'Đồng nghiệp';
        document.getElementById('view-prof-status').innerText = prof.status ? `Status: ${prof.status}` : '';
        document.getElementById('view-prof-bio').innerText = prof.bio || 'Chưa viết tiểu sử.';
    }

    // 2. Kiểm tra trạng thái đã Follow hay chưa để đổi chữ trên nút bấm
    const { data: followCheck } = await spClient.from('follows').select('*').eq('follower_id', currentUser.id).eq('following_id', userId);
    const btnFollow = document.getElementById('btn-follow');
    if (followCheck && followCheck.length > 0) {
        btnFollow.innerText = "🔕 Hủy Theo Dõi";
        btnFollow.style.backgroundColor = "#dc3545";
        btnFollow.style.color = "white";
    } else {
        btnFollow.innerText = "🔔 Theo Dõi";
        btnFollow.style.backgroundColor = "#007bff";
        btnFollow.style.color = "white";
    }

    // 3. Tải riêng các bài viết do người này đăng
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
    visitUserProfile(selectedUserId); // Khởi tạo lại trạng thái giao diện tường nhà
}

// MODULE 3: CHAT RIÊNG BIỆT 1 - 1 (DIRECT MESSAGE)
async function openDirectMessage() {
    switchTab('dm-chat');
    const { data: prof } = await spClient.from('profiles').select('full_name').eq('id', selectedUserId).single();
    document.getElementById('dm-target-name').innerText = `🔒 Chat riêng với: ${prof?.full_name || 'Đồng nghiệp'}`;
    
    loadPrivateMessages();

    // Thiết lập cổng lắng nghe Realtime riêng biệt cho 2 người, không ảnh hưởng chat tổng toàn công ty
    dmSubscription = spClient.channel(`room:${currentUser.id}-${selectedUserId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'private_messages' }, payload => {
        loadPrivateMessages();
    })
    .subscribe();
}

async function loadPrivateMessages() {
    // Lấy tin nhắn giữa người A gửi người B hoặc người B gửi người A
    const { data: messages } = await spClient
        .from('private_messages')
        .select('*')
        .or(`and(sender_id.eq.${currentUser.id},receiver_id.eq.${selectedUserId}),and(sender_id.eq.${selectedUserId},receiver_id.eq.${currentUser.id})`)
        .order('created_at', { ascending: true });

    const chatBox = document.getElementById('dm-messages');
    chatBox.innerHTML = '';

    if(messages) {
        messages.forEach(m => {
            const isMine = m.sender_id === currentUser.id;
            const bubble = document.createElement('div');
            bubble.style.textAlign = isMine ? 'right' : 'left';
            bubble.innerHTML = `
                <div style="display:inline-block; background:${isMine ? '#d4edda' : '#eee'}; padding:8px 12px; margin:5px; border-radius:10px; max-width:70%;">
                    ${m.content}
                </div>
            `;
            chatBox.appendChild(bubble);
        });
    }
    chatBox.scrollTop = chatBox.scrollHeight;
}

async function sendPrivateMessage() {
    const input = document.getElementById('dm-input');
    if(!input.value.trim()) return;

    await spClient.from('private_messages').insert([
        { sender_id: currentUser.id, receiver_id: selectedUserId, content: input.value }
    ]);
    input.value = '';
    loadPrivateMessages();
}

// MODULE 4: PHÒNG CHAT CHUNG REALTIME TOÀN CÔNG TY
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
    const { data: msgs } = await spClient
        .from('messages')
        .select(`id, content, is_recalled, user_id, profiles(full_name)`)
        .order('created_at', { ascending: true });

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
            <div class="msg-user">${m.profiles?.full_name || 'Đồng nghiệp'}</div>
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
