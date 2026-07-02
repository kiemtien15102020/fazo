// CẤU HÌNH KẾT NỐI SUPABASE
const SUPABASE_URL = "https://nbciwifubobjohwmdjwg.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_-a4LSSVo-va31CIo7P5z4A_rMbL1tNj";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let currentUser = null;

// KHỞI CHẠY KIỂM TRA ĐĂNG NHẬP
supabase.auth.onAuthStateChange((event, session) => {
    if (session) {
        currentUser = session.user;
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('app-page').classList.remove('hidden');
        loadNewsfeed();
        loadProfileData();
        listenRealtimeChat(); // Bật realtime lắng nghe chat
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
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert("Đăng nhập thất bại: " + error.message);
}

async function loginWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) alert("Lỗi kết nối Google: " + error.message);
}

async function logout() {
    await supabase.auth.signOut();
}

// CHUYỂN ĐỔI GIAO DIỆN TAB
function switchTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
    document.getElementById(`tab-${tabName}`).classList.remove('hidden');
    if(tabName === 'newsfeed') loadNewsfeed();
}

// MODULE 1: NEWSFEED & BÀI VIẾT
async function createNewPost() {
    const content = document.getElementById('post-content').value;
    if(!content.trim()) return alert("Nội dung không được để trống!");

    const { error } = await supabase.from('posts').insert([{ user_id: currentUser.id, content: content }]);
    if (error) alert(error.message);
    else {
        document.getElementById('post-content').value = '';
        loadNewsfeed();
    }
}

async function loadNewsfeed() {
    const { data: posts, error } = await supabase
        .from('posts')
        .select(`id, content, created_at, user_id, profiles(full_name, avatar_url)`)
        .order('created_at', { ascending: false });

    if (error) return;
    
    const feedContainer = document.getElementById('newsfeed-list');
    feedContainer.innerHTML = '';

    for (let post of posts) {
        // Lấy số lượng Likes cho bài viết
        const { count: likeCount } = await supabase.from('likes').select('*', { count: 'exact', head: true }).eq('post_id', post.id);
        // Lấy danh sách Comments
        const { data: comments } = await supabase.from('comments').select(`id, content, user_id, profiles(full_name)`).eq('post_id', post.id);

        let commentHtml = '';
        comments.forEach(c => {
            commentHtml += `<div class="comment-item"><b>${c.profiles?.full_name || 'Đồng nghiệp'}:</b> ${c.content}</div>`;
        });

        const postCard = document.createElement('div');
        postCard.className = 'card post-card';
        postCard.innerHTML = `
            <div class="post-header">
                <img src="${post.profiles?.avatar_url || 'https://via.placeholder.com/150'}">
                <div class="post-meta">
                    <h4>${post.profiles?.full_name || 'Đồng nghiệp'}</h4>
                    <span>${new Date(post.created_at).toLocaleString('vi-VN')}</span>
                </div>
            </div>
            <div class="post-body"><p>${post.content}</p></div>
            <div class="post-actions">
                <button onclick="likePost('${post.id}')">❤️ Thích (${likeCount || 0})</button>
                <button onclick="deletePost('${post.id}', '${post.user_id}')">🗑️ Xóa bài</button>
            </div>
            <div class="comment-section">
                <div class="comments-list">${commentHtml}</div>
                <div class="comment-input-group">
                    <input type="text" id="input-cmt-${post.id}" placeholder="Viết bình luận...">
                    <button onclick="sendComment('${post.id}')">Gửi</button>
                </div>
            </div>
        `;
        feedContainer.appendChild(postCard);
    }
}

async function likePost(postId) {
    await supabase.from('likes').insert([{ user_id: currentUser.id, post_id: postId }]);
    loadNewsfeed();
}

async function deletePost(postId, postOwnerId) {
    if(currentUser.id !== postOwnerId) return alert("Bạn không có quyền xóa bài viết của người khác!");
    if(confirm("Bạn chắc chắn muốn xóa bài viết này?")) {
        await supabase.from('posts').delete().eq('id', postId);
        loadNewsfeed();
    }
}

async function sendComment(postId) {
    const input = document.getElementById(`input-cmt-${postId}`);
    if(!input.value.trim()) return;
    await supabase.from('comments').insert([{ post_id: postId, user_id: currentUser.id, content: input.value }]);
    input.value = '';
    loadNewsfeed();
}

// MODULE 2: CHAT REALTIME TOÀN CÔNG TY
async function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if(!input.value.trim()) return;
    await supabase.from('messages').insert([{ user_id: currentUser.id, content: input.value }]);
    input.value = '';
}

function listenRealtimeChat() {
    // Tải trước tin nhắn cũ
    loadChatMessages();

    // Lắng nghe realtime sự kiện chèn dòng mới vào bảng messages
    supabase.channel('public:messages')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        loadChatMessages();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, payload => {
        loadChatMessages();
    })
    .subscribe();
}

async function loadChatMessages() {
    const { data: msgs } = await supabase
        .from('messages')
        .select(`id, content, is_recalled, user_id, profiles(full_name)`)
        .order('created_at', { ascending: true });

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
    chatArea.scrollTop = chatArea.scrollHeight; // Tự cuộn xuống cuối
}

async function recallMessage(msgId) {
    await supabase.from('messages').update({ is_recalled: true }).eq('id', msgId);
}

// MODULE 3: TRANG CÁ NHÂN
async function loadProfileData() {
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', currentUser.id).single();
    if(prof) {
        document.getElementById('prof-avatar').src = prof.avatar_url || 'https://via.placeholder.com/150';
        document.getElementById('prof-name').innerText = prof.full_name;
        document.getElementById('prof-status-input').value = prof.status || '';
        document.getElementById('prof-bio-input').value = prof.bio || '';
    }
}

async function updateProfile() {
    const status = document.getElementById('prof-status-input').value;
    const bio = document.getElementById('prof-bio-input').value;
    
    await supabase.from('profiles').update({ status, bio }).eq('id', currentUser.id);
    alert("Cập nhật trang cá nhân thành công!");
}