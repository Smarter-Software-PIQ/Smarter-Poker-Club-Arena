/* Credential-free native result/ordinal contract, compiled only by the builder.
 * This is not schema, transport, database or connected acceptance evidence. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <stdarg.h>
#include <unistd.h>
#define lengthof(x) (sizeof(x)/sizeof((x)[0]))
typedef unsigned int Oid;
typedef struct { Oid oid; } CatalogId;
typedef struct { int objType, dump, components; CatalogId catId; } DumpableObject;
typedef struct { DumpableObject dobj; } FuncInfo;
typedef struct { int unused; } Archive;
typedef struct { int status, rows, fields, cleared; } PGresult;
typedef struct { char data[8192]; } Buffer;
typedef Buffer *PQExpBuffer;
#define DO_FUNC 1
#define PGRES_TUPLES_OK 2
static const char *mode;
static int sent, delivered, cleared, requests, query_open;
static PGresult results[129];
static const char *names[] = {"proretset","prosrc","probin","provolatile","proisstrict","prosecdef","lanname","proconfig","procost","prorows","funcargs","funciargs","funcresult","proleakproof","protrftypes","proparallel","prokind","prosupport","prosqlbody"};
static void pg_fatal(const char *message) { (void)message; exit(23); }
static PQExpBuffer createPQExpBuffer(void) { return calloc(1,sizeof(Buffer)); }
static void destroyPQExpBuffer(PQExpBuffer b) { free(b); }
static void appendPQExpBuffer(PQExpBuffer b,const char *format,Oid oid) {
    size_t used=strlen(b->data); snprintf(b->data+used,sizeof(b->data)-used,format,oid);
}
static void *GetConnection(Archive *a) { return a; }
static void ca_diag_query_begin(void) { if(query_open)exit(90); query_open=1; }
static void ca_diag_query_end(void) { if(!query_open)exit(91); query_open=0; }
static int PQsendQuery(void *connection,const char *sql) {
    (void)connection;
    if(!strcmp(mode,"send")) return 0;
    sent=delivered=0;requests++;
    for(;*sql;sql++) if(*sql==';')sent++;
    if(sent<1||sent>128)exit(92);
    return 1;
}
static PGresult *PQgetResult(void *connection) {
    PGresult *r;(void)connection;
    if(!strcmp(mode,"interrupt")) { if(write(STDOUT_FILENO,"WAIT\n",5)!=5)exit(96); sleep(20); }
    if(delivered==sent+(!strcmp(mode,"extra")?1:0)-(!strcmp(mode,"missing")?1:0))return NULL;
    r=&results[delivered++];r->status=PGRES_TUPLES_OK;r->rows=1;r->fields=19;r->cleared=0;
    if(!strcmp(mode,"status"))r->status=9;
    if(!strcmp(mode,"rows"))r->rows=0;
    if(!strcmp(mode,"fields"))r->fields=18;
    return r;
}
static int PQresultStatus(PGresult *r){return r->status;}
static int PQntuples(PGresult *r){return r->rows;}
static int PQnfields(PGresult *r){return r->fields;}
static char *PQfname(PGresult *r,int f){(void)r;return (char *)(!strcmp(mode,"name")?"wrong":names[f]);}
static int PQgetlength(PGresult *r,int row,int f){(void)r;(void)row;(void)f;return !strcmp(mode,"bytes")?128*1024*1024:1;}
static void PQclear(PGresult *r){if(r->cleared)exit(93);r->cleared=1;cleared++;}
#include "native-dump-function-batch.c"
int main(int argc,char **argv) {
    Archive archive={0};int i,n;DumpableObject **objects;FuncInfo *functions;
    if(argc!=3)return 94;
    mode=argv[1];n=atoi(argv[2]);
    objects=calloc(n,sizeof(*objects));functions=calloc(n,sizeof(*functions));
    for(i=0;i<n;i++) {
        functions[i].dobj=(DumpableObject){DO_FUNC,1,1,{(Oid)(i+1)}};
        if(i%137==136) functions[i].dobj.objType=2; /* preserved non-function boundary */
        if(i%131==130) functions[i].dobj.dump=0; /* excluded component */
        objects[i]=&functions[i].dobj;
    }
    ca_batch_objects=objects;ca_batch_objects_count=n;
    for(i=0;i<n;i++) {
        PGresult *r;ca_batch_position=i;
        if(objects[i]->objType!=DO_FUNC || !objects[i]->dump)continue;
        if(!strcmp(mode,"order") && i==1)ca_batch_oids[ca_batch_next]=99999;
        r=ca_function_batch_result(&archive,&functions[i]);PQclear(r);
    }
    if(ca_batch_count!=ca_batch_next || query_open || (n>128 && requests<2))return 95;
    free(objects);free(functions);return 0;
}
