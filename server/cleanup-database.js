const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function cleanupDatabase() {
    console.log('🧹 Starting database cleanup...');
    
    try {
        // Delete in reverse order to avoid foreign key constraints
        console.log('Deleting messages...');
        const { error: messagesError } = await supabase
            .from('messages')
            .delete()
            .gt('id', 0); // Delete all records
        
        if (messagesError) throw messagesError;
        console.log('✅ Messages deleted');

        console.log('Deleting chats...');
        const { error: chatsError } = await supabase
            .from('chats')
            .delete()
            .gt('id', 0); // Delete all records
        
        if (chatsError) throw chatsError;
        console.log('✅ Chats deleted');

        console.log('Deleting users_in_room...');
        const { error: usersError } = await supabase
            .from('users_in_room')
            .delete()
            .gt('id', 0); // Delete all records
        
        if (usersError) throw usersError;
        console.log('✅ Users in room deleted');

        console.log('Deleting rooms...');
        const { error: roomsError } = await supabase
            .from('rooms')
            .delete()
            .gt('id', 0); // Delete all records
        
        if (roomsError) throw roomsError;
        console.log('✅ Rooms deleted');

        console.log('🎉 Database cleanup completed successfully!');
        
    } catch (error) {
        console.error('❌ Database cleanup failed:', error.message);
    }
}

// Run the cleanup
cleanupDatabase().then(() => {
    console.log('Cleanup script finished');
    process.exit(0);
});
