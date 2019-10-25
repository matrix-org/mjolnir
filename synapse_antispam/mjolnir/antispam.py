class AntiSpam(object):
    def __init__(self, config):
        self._block_invites = config.get("block_invites", True)
        self._block_messages = config.get("block_messages", False)
        self._list_room_ids = config.get("ban_lists", [])

    def check_event_for_spam(self, event):
        return False # not spam

    def user_may_invite(self, inviter_user_id, invitee_user_id, room_id):
        return True # allowed

    def user_may_create_room(self, user_id):
        return True # allowed

    def user_may_create_room_alias(self, user_id, room_alias):
        return True # allowed

    def user_may_publish_room(self, user_id, room_id):
        return True # allowed

    @staticmethod
    def parse_config(config):
        return config # no parsing needed
