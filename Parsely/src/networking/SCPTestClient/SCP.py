import logging

from pydicom.dataset import Dataset
from pydicom.dataset import Dataset
from pynetdicom import AE, evt, AllStoragePresentationContexts, build_role
from pynetdicom.sop_class import (
    PatientRootQueryRetrieveInformationModelFind,
    StudyRootQueryRetrieveInformationModelFind,
    StudyRootQueryRetrieveInformationModelMove,
    PatientRootQueryRetrieveInformationModelMove,
    Verification
)
from pynetdicom import (
   AE, debug_logger, evt, AllStoragePresentationContexts,
   ALL_TRANSFER_SYNTAXES
)

debug_logger()

echo_success_code = 0x0000

def handle_echo(_event):
   return echo_success_code  

def handle_store(event):
   """Handle EVT_C_STORE events."""
   ds = event.dataset
   ds.file_meta = event.file_meta
   ds.save_as(ds.SOPInstanceUID, write_like_original=False)

   return 0x0000

handlers = [(evt.EVT_C_STORE, handle_store)]

ae = AE()
ae.ae_title = 'MY_SCP'
ae.add_supported_context(Verification)

storage_sop_classes = [
   cx.abstract_syntax for cx in AllStoragePresentationContexts
]

for uid in storage_sop_classes:
   ae.add_supported_context(uid, ALL_TRANSFER_SYNTAXES)

try:
   print('Starting server on localhost:8888...')
   ae.start_server(
   ('127.0.0.1', 8888), 
   evt_handlers=[
         (evt.EVT_C_ECHO, handle_echo), 
         # (evt.EVT_C_FIND, handle_find), 
         # (evt.EVT_C_MOVE, handle_move)
      ]
   )
except Exception as e:
   print(f"Failed to start server: {e}")